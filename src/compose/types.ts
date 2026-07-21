export interface ComposeService {
  name: string;
  image?: string;
  workingDir?: string;
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