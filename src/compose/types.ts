export interface ComposeService {
  name: string;
  image?: string;
  workingDir?: string;
  /**
   * Docker state string (`running`, `exited`, `created`, ...) or empty string
   * when the service has never been started. Drives which inline icons appear
   * next to the row in the Compose Services view.
   */
  state: string;
}

export interface ComposeProject {
  name: string;
  services: ComposeService[];
  composeFilePath: string;
}

export interface ComposeFileRef {
  label: string;
  path: string;
}