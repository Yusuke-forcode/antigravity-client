# Security and Behavioral Audit Report: Antigravity Client

## Overview

This report details the findings from an audit of the `antigravity-client` repository. The codebase implements an unofficial TypeScript client and CLI for the Antigravity Language Server, enabling interaction with the local language server process, typically used by an IDE, without the IDE itself.

## Architecture and Execution Model

The repository functions as a wrapper around the pre-existing Antigravity Language Server (`language_server` binary).

- **Launcher (`src/server/launcher.ts`)**: Responsible for spawning the `language_server` binary. It injects mock extension server settings to allow the binary to start in standalone mode. It controls the local port the binary uses and sets several important arguments like `--csrf_token`.
- **Auth Reader (`src/server/auth-reader.ts`)**: Reads authentication details, specifically the OAuth tokens, from the user's local `state.vscdb` file (SQLite format) to authenticate the standalone instance. This is a read-only operation.
- **Web Proxy (`src/server/web-poc/server.ts`)**: Starts a local HTTPS server that acts as a proxy between a web browser and the Language Server. It injects a shim to simulate the Electron environment that the original UI expects.
- **Event Parser (`src/core/cascade/event-parser.ts`)**: Interprets the protobuf responses from the Language Server into a more accessible event-driven API. It handles parsing events like `runCommand` and file system permissions.

## Security Findings

1. **Network Binding**:
   - The code is explicitly designed to run locally. Bindings in both `server/web-poc/server.ts` and `core/client.ts` are hardcoded to `127.0.0.1` and `localhost`. There is no evidence of the server opening ports on `0.0.0.0` or attempting to expose the service to external networks by default.

2. **Command Execution**:
   - The application manages system interactions (like running commands or writing to files) through the Language Server. It includes handlers for `runCommand`, `filePermission`, and other interactions (`src/core/cascade/event-parser.ts`), which appear to pass requests to the Language Server or handle prompts for user approval.
   - The actual execution of these commands seems to be delegated to the Language Server binary itself, though the client provides ways to approve or deny these actions.

3. **Authentication Data Handling**:
   - The application accesses `state.vscdb` to read OAuth tokens. This access is local and read-only. There is no code observed that exfiltrates this data to an unauthorized third party.

4. **Self-Signed Certificates**:
   - The web proxy generates a self-signed certificate using `openssl` to serve the UI over HTTP/2, which is required by modern browsers for certain streaming features. This is a standard local development practice.

## Behavioral and LLM Prompt Findings

1. **Protobuf and Prompts**:
   - The reconstructed protobuf schemas (`src/proto_generated/exa/`) contain numerous references to prompts, such as `system_prompt`, `guideline_prompt`, `use_antigravity_as_browser_prompting`, and various prompt strategies. These appear to represent the configuration options and features available in the backend Language Server, not injected prompt injections by this specific repository.
   - Features like `continue_after_injection` are present in the protobuf definitions, which likely refer to code generation or context injection capabilities within the Language Server, rather than malicious code injection.

2. **Execution Flags**:
   - Flags like `allow_auto_run_commands` and `cascade_can_auto_run_commands` are configurable. The client provides methods to programmatically approve or deny commands (`approveCommand`, `denyCommand`), maintaining user control unless explicitly automated by the user's implementation.

## Concerns and Risks

While the repository does not appear malicious, there are significant structural and operational concerns:

1. **Remote Execution via Tailscale (Network Exposure)**
   - When running the `web-poc` proxy server without explicitly defining a secure local host limit, Node.js binds to `0.0.0.0`. If a user utilizes a VPN like Tailscale, their Antigravity instance becomes exposed on their VPN network. While this allows smartphone access, it also means anyone on that Tailscale network (if misconfigured or shared) could access the UI and gain arbitrary code execution capabilities on the host PC.

2. **Auto-Run Execution Risks**
   - The `EventParser` implementation bridges commands like `runCommand` directly from the Language Server to the client. If an automated script or a reckless user sets `autoRun` configurations to true (`allow_auto_run_commands`), the AI gains unrestricted, unsupervised access to execute shell commands and modify the file system.

3. **Fragility and Future Updates (Reverse Engineering)**
   - **This is the biggest concern.** The entire SDK is built upon reverse-engineered Protobuf schemas (`src/proto_generated/`). Antigravity Language Server is a closed-source product.
   - **Breakage is Highly Likely:** Whenever Google/Antigravity updates the IDE and changes the underlying gRPC schema, adds new fields, or renames methods, this client will **break instantly**.
   - **Maintenance Burden:** There is zero guarantee of compatibility with future versions. Using this tool relies on the community or the maintainer continually re-reverse-engineering the bundled Webpack/Electron output of the official IDE to extract the new schemas after every official update.

## Conclusion

The `antigravity-client` codebase acts as a legitimate bridge to interact with the Antigravity Language Server programmatically. The audit did not reveal any malicious backdoors, unexpected data exfiltration, or harmful prompt injections native to this repository. The security boundary primarily relies on the underlying Antigravity Language Server binary and the fact that the services are bound to the local loopback interface (`127.0.0.1`).

However, users must be highly cautious regarding auto-execution of commands and should be prepared for the tool to break without warning due to upstream updates.
