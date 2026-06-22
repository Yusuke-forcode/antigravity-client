
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface ServerInfo {
  pid: number;
  httpPort: number;       // The port from --extension_server_port (HTTP/JSON)
  httpsPort?: number;     // The port for Connect RPC (HTTP/2 + TLS)
  csrfToken: string;
  workspaceId: string;
  startTime: Date;
}

export class AutoDetector {
  /**
   * Returns all running Language Server processes with extracted info.
   */
  async findAllServers(): Promise<ServerInfo[]> {
    const pids = await this.getLanguageServerPids();
    if (pids.length === 0) return [];

    const servers = (await Promise.all(pids.map((pid) => this.inspectProcess(pid))))
      .filter((s): s is ServerInfo => s !== null);

    // Sort by start time (newest first)
    servers.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

    // Populate HTTPS ports
    for (const server of servers) {
      server.httpsPort = await this.findHttpsPort(server.pid) || undefined;
    }

    return servers;
  }

  /**
   * Finds the most relevant running Language Server process.
   */
  async findBestServer(workspacePath?: string): Promise<ServerInfo> {
    const servers = await this.findAllServers();
    if (servers.length === 0) {
      throw new Error("No Antigravity Language Server running. Please open Antigravity (VS Code).");
    }

    let targetServer: ServerInfo | undefined;

    if (workspacePath) {
      const normalizedPath = workspacePath.replace(/\//g, '_');
      targetServer = servers.find(s => s.workspaceId.includes(normalizedPath));
    }

    if (!targetServer) {
        targetServer = servers[0];
    }

    if (!targetServer.httpsPort) {
        console.warn(`[AutoDetector] Warning: Could not determine HTTPS port for PID ${targetServer.pid}. RPC might fail.`);
    }

    return targetServer;
  }

  /**
   * Returns a list of PIDs for "language_" processes listening on TCP.
   */
  private async getLanguageServerPids(): Promise<number[]> {
    try {
      let pids: number[] = [];
      if (process.platform === "win32") {
        const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq language_server.exe" /NH');
        const lines = stdout.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          const match = line.match(/language_server\.exe\s+(\d+)/i);
          if (match) pids.push(parseInt(match[1], 10));
        }
      } else {
        const { stdout } = await execAsync("lsof -nP -iTCP -sTCP:LISTEN | grep language_ | awk '{print $2}'");
        pids = stdout.trim().split("\n")
          .filter(Boolean)
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n));
      }

      return [...new Set(pids)];
    } catch (e) {
      return [];
    }
  }

  /**
   * Extract basic info from process.
   */
  private async inspectProcess(pid: number): Promise<ServerInfo | null> {
    try {
      let argsOut = "";
      let lstartOut = new Date().toISOString(); // Default to current time for Windows

      if (process.platform === "win32") {
        const { stdout } = await execAsync(`wmic process where processid=${pid} get commandline /format:list`);
        argsOut = stdout;
      } else {
        const { stdout: macArgsOut } = await execAsync(`ps -p ${pid} -o args=`);
        const { stdout: macLstartOut } = await execAsync(`LC_ALL=C ps -p ${pid} -o lstart=`);
        argsOut = macArgsOut;
        lstartOut = macLstartOut;
      }

      const portMatch = argsOut.match(/--extension_server_port\s+(\d+)/);
      const csrfMatch = argsOut.match(/--csrf_token\s+([a-f0-9-]+)/);
      const workspaceMatch = argsOut.match(/--workspace_id\s+([^\s]+)/);

      if (!csrfMatch) {
         return null;
      }

      return {
        pid,
        httpPort: portMatch ? parseInt(portMatch[1], 10) : 0,
        csrfToken: csrfMatch[1],
        workspaceId: workspaceMatch ? workspaceMatch[1] : "unknown",
        startTime: new Date(lstartOut.trim())
      };

    } catch (e) {
      return null;
    }
  }

  /**
   * Finds the HTTPS port (Connect RPC endpoint) for the given PID.
   * LS opens ports in order: HTTPS -> HTTP -> LSP.
   */
  private async findHttpsPort(pid: number): Promise<number | null> {
    try {
      if (process.platform === "win32") {
        const { stdout } = await execAsync(`netstat -ano | findstr LISTENING | findstr ${pid}`);
        const lines = stdout.trim().split("\n").filter(Boolean);
        const ports: number[] = [];
        for (const line of lines) {
          const match = line.match(/TCP\s+[\d\.]+:(\d+)/i);
          if (match) {
            ports.push(parseInt(match[1], 10));
          }
        }
        if (ports.length === 0) return null;
        // The first port opened is usually the HTTPS port.
        // `netstat` output is not guaranteed to be chronologically ordered by FD like `lsof`.
        // However, Antigravity uses port 0 and relies on the OS to assign them sequentially in short order.
        return Math.min(...ports);
      } else {
        const { stdout } = await execAsync(`lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid}`);
        const lines = stdout.trim().split("\n").filter(l => l.includes("LISTEN"));

        const entries: { fd: number; port: number }[] = [];
        for (const line of lines) {
          const fdMatch = line.match(/\s+(\d+)u\s+IPv/);
          const portMatch = line.match(/:(\d+)\s+\(LISTEN\)/);
          if (fdMatch && portMatch) {
            entries.push({ fd: parseInt(fdMatch[1], 10), port: parseInt(portMatch[1], 10) });
          }
        }

        if (entries.length === 0) return null;
        entries.sort((a, b) => a.fd - b.fd);
        return entries[0].port;
      }
    } catch (e) {
      return null;
    }
  }
}
