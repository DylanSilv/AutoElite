/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Nombre del comercio en la pantalla de login, antes de saber quién entra.
   * Ver el comentario en LoginPage.
   */
  readonly VITE_COMMERCE_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
