import {
  MarkdownString,
  StatusBarAlignment,
  StatusBarItem,
  window
} from 'vscode';

/**
 * Persistent info block at the bottom of the VS Code window.
 *
 * VS Code has no native "sidebar footer" for custom views, so the closest
 * always-visible surface is the global status bar (sits directly below the
 * sidebar). The block shows the extension name + installed version at all
 * times, with a tooltip that exposes the publisher as a clickable hyperlink
 * to the project's GitHub repository.
 */
export interface InfoStatusBarOptions {
  name: string;
  version: string;
  publisher: string;
  repoUrl: string;
  openRepoCommand: string;
}

export class InfoStatusBar {
  private readonly item: StatusBarItem;

  constructor(opts: InfoStatusBarOptions) {
    this.item = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    this.item.text = `$(info) ${opts.name} v${opts.version}`;
    const tip = new MarkdownString(
      `**${opts.name}** v${opts.version}\n\n` +
        `Publisher: [${opts.publisher}](${opts.repoUrl})\n\n` +
        `_Click to open repository_`
    );
    tip.isTrusted = { enabledCommands: [opts.openRepoCommand] };
    this.item.tooltip = tip;
    this.item.command = {
      title: `Open ${opts.publisher} on GitHub`,
      command: opts.openRepoCommand
    };
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}