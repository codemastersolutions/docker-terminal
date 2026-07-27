import type { ContainerInfo } from '../docker/client';

/**
 * Wrapper so the TreeDataProvider can hand a stable object back to VS Code.
 * The underlying `ContainerInfo` is what's stored; this class only adds the
 * collapsible state (always None for leaf containers).
 */
export class ContainerTreeItem {
  constructor(
    public readonly info: ContainerInfo,
    public readonly collapsibleState: 0 = 0
  ) {}
}
