# Windows 環境動作確認ガイドライン

このドキュメントは、`antigravity-client` が Windows 環境で正常に動作するかを検証・確認するためのテスト手順をまとめたものです。
UNIX系特有のコマンド依存を排除したバージョンにおいて、以下の手順で動作確認を行ってください。

---

## 1. 事前準備 (Prerequisites)

Windows マシンでテストを行うにあたり、以下の環境が整っていることを確認してください。

1. **Node.js**: v18 以上がインストールされていること。
2. **Antigravity のインストール**: VS Code 等を通じて Antigravity 拡張機能が Windows PC にインストールされ、ログイン・認証が完了していること。
   - `C:\Users\<UserName>\AppData\Roaming\Antigravity\User\globalStorage\state.vscdb` が存在していることを確認します。
   - `C:\Users\<UserName>\AppData\Local\Programs\Antigravity\resources\bin\language_server.exe` または類似のパスにバイナリが存在していることを確認します。
3. **C++ ビルドツール**: `better-sqlite3` をインストールするため、Python および Visual Studio の C++ ビルドツール（または `windows-build-tools`）が必要です。

---

## 2. 依存関係のインストールとビルド検証

ターミナル（PowerShell または コマンドプロンプト）を開き、以下のコマンドがエラーなく完了することを確認します。

```powershell
# 依存関係のクリーンインストール
npm ci

# ビルドの実行（tsc エラーが出ないこと）
npm run build
```

---

## 3. テスト項目の実行

Windows 環境でネイティブコマンド（`tasklist`, `wmic`, `netstat` 等）が正しく動作するかを以下の順にテストします。

### テスト A: SQLite 認証情報の読み取りテスト (auth-reader.ts)
`better-sqlite3` が Windows のパスにある `state.vscdb` を正しく読み取れるか確認します。

1. 新しいファイル `test_auth.ts` を作成し、以下を実行します：
   ```typescript
   import { readAuthData } from "./src/server/auth-reader.js";
   const auth = readAuthData();
   console.log("API Key found:", !!auth.apiKey);
   console.log("OAuth Topic key:", auth.ussOAuth.key);
   ```
2. `npx tsx test_auth.ts` を実行し、APIキーが存在すること（`true`）を確認します。

### テスト B: Language Server の自動検出テスト (autodetect.ts)
VS Code 等で Antigravity を立ち上げた状態で、プロセス検出が機能するか確認します。

1. VS Code を起動し、Antigravity をアクティブにします。
2. `npx tsx examples/test_universal.ts` （または `test_chat.ts`）を実行します。
3. 「Connected to LS on port...」と表示され、AIと簡単なチャット（送受信）ができることを確認します。
   - ※ここでエラーが出る場合、`wmic` や `netstat` のパースが失敗している可能性があります。

### テスト C: スタンドアロン・モードと証明書生成テスト (web-poc)
`openssl` への依存を排除した `selfsigned` による証明書生成と、独立した LS 起動が機能するか確認します。

1. **※事前に開いている VS Code をすべて閉じます**（ポートの競合やプロセスの二重起動を防ぐため）。
2. 以下のコマンドを実行して Web UI サーバーを起動します。
   ```powershell
   npm run web
   ```
3. ターミナルに以下のような出力が出れば成功です。
   ```text
   [poc] generating self-signed localhost cert…
   [Launcher] Mock Extension Server on port XXXXX
   [poc] LS ready: HTTPS XXXXX, csrf xxxxxxxx…
   ============================================================
     本家UI (web):  https://localhost:8765/   (HTTP/2)
     Upstream LS:    https://127.0.0.1:XXXXX
   ============================================================
   ```
4. ブラウザ（Chrome または Edge）で `https://localhost:8765/` にアクセスします。
5. 「接続がプライベートではありません」と警告が出たら、「詳細設定」から「localhost にアクセスする（安全ではありません）」をクリックします。
6. Antigravity のチャット画面が表示され、正しくメッセージの送受信ができることを確認します。

---

## 4. トラブルシューティング（Windows特有の事象）

- **`better-sqlite3` のインストールエラー:**
  C++ コンパイラが不足しています。管理者権限の PowerShell で `npm install --global windows-build-tools` を実行するか、Visual Studio Installer から「C++ によるデスクトップ開発」をインストールしてください。
- **`wmic` 実行時のエラー:**
  一部の最新 Windows 11 環境では `wmic` が非推奨となりデフォルトで無効化されている場合があります。その場合は `Get-CimInstance` などの PowerShell コマンドへの置き換えを検討する必要があります。
- **ポートのブロック:**
  Windows ファイアウォールが `language_server.exe` や Node.js の通信をブロックする旨のダイアログが出た場合は、「許可する」を選択してください。