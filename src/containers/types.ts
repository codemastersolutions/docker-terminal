import type { ContainerInfo } from '../docker/client';
import type { ScriptEntry } from './scripts';

export type ContainerTreeItem =
  | ContainerGroupTreeItem
  | ContainerScriptTreeItem;

export class ContainerGroupTreeItem {
  readonly kind = 'container' as const;
  constructor(
    public readonly info: ContainerInfo
  ) {}
}

export class ContainerScriptTreeItem {
  readonly kind = 'script' as const;
  constructor(
    public readonly parentInfo: ContainerInfo,
    public readonly script: ScriptEntry
  ) {}
}
