/// <reference types="vite/client" />
/// <reference types="dom-chromium-ai" />

interface ImportMetaEnv {
  readonly VITE_MCP_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
