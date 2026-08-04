/**
 * ObsidianCode - Input toolbar components (model selector, thinking budget, permission toggle).
 */

import { Notice, setIcon } from 'obsidian';

import type { CatalogEntry, ModelCatalog, RawModelEntry } from '../../core/models/ModelCatalog';
import { findCatalogEntry, resolveModelCatalog } from '../../core/models/ModelCatalog';
import type {
  ClaudeModel,
  ObsidianCodeMcpServer,
  PermissionMode,
  ThinkingBudget
} from '../../core/types';
import {
  DEFAULT_CLAUDE_MODELS,
  THINKING_BUDGETS
} from '../../core/types';
import { CHECK_ICON_SVG, MCP_ICON_SVG } from '../../features/chat/constants';
import type { McpService } from '../../features/mcp/McpService';
import { findConflictingPath } from '../../utils/externalContext';

/** Settings access interface for toolbar components. */
export interface ToolbarSettings {
  model: ClaudeModel;
  thinkingBudget: ThinkingBudget;
  permissionMode: PermissionMode;
  lastNonPlanPermissionMode?: 'yolo' | 'normal';
}

/** Callback interface for toolbar changes. */
export interface ToolbarCallbacks {
  onModelChange: (model: ClaudeModel) => Promise<void>;
  onThinkingBudgetChange: (budget: ThinkingBudget) => Promise<void>;
  onPermissionModeChange: (mode: PermissionMode) => Promise<void>;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
  /** Returns the model list fetched from the Anthropic API (null when unavailable). */
  getRuntimeModels?: () => RawModelEntry[] | null;
  /** Re-fetches the model list; resolves to false when the fetch fails. */
  onRefreshModels?: () => Promise<boolean>;
  /** Whether plan mode was initiated by the agent (EnterPlanMode tool). */
  isAgentInitiatedPlanMode?: () => boolean;
  /** Whether the user has requested plan mode (UI/prefix only). */
  isPlanModeRequested?: () => boolean;
}

/**
 * Model selector menu.
 *
 * Mirrors the Claude Code model menu: a "Models" list showing one row per
 * family named after the version it currently resolves to ("Opus 5"), with a
 * number shortcut on each row and a checkmark on the active one. Pinned
 * versions live in a "More models" submenu.
 *
 * The rows are CLI aliases, so when a new version ships the row renames itself
 * and keeps resolving to the newest release with no plugin update.
 */
export class ModelSelector {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private isOpen = false;
  private view: 'root' | 'more' = 'root';
  private isRefreshing = false;
  private onDocumentClick: ((e: MouseEvent) => void) | null = null;
  private onDocumentKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'oc-model-selector' });
    this.render();
  }

  /** Builds the catalog from the fetched list, env vars, and offline fallback. */
  private getCatalog(): ModelCatalog {
    return resolveModelCatalog({
      runtimeModels: this.callbacks.getRuntimeModels?.() ?? null,
      envText: this.callbacks.getEnvironmentVariables?.() ?? '',
      fallbackModels: DEFAULT_CLAUDE_MODELS,
    });
  }

  private render() {
    this.container.empty();

    this.buttonEl = this.container.createDiv({ cls: 'oc-model-btn' });
    this.buttonEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'oc-model-dropdown' });
    this.renderOptions();
  }

  /** Opens or closes the menu. */
  private toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.view = 'root';
    this.dropdownEl?.addClass('is-open');

    // Close on any click outside, and drive the number shortcuts while open.
    this.onDocumentClick = (e: MouseEvent) => {
      if (!this.container.contains(e.target as Node)) this.close();
    };
    this.onDocumentKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
    document.addEventListener('click', this.onDocumentClick);
    document.addEventListener('keydown', this.onDocumentKeyDown, true);

    this.renderOptions();
  }

  private close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.view = 'root';
    this.dropdownEl?.removeClass('is-open');

    if (this.onDocumentClick) {
      document.removeEventListener('click', this.onDocumentClick);
      this.onDocumentClick = null;
    }
    if (this.onDocumentKeyDown) {
      document.removeEventListener('keydown', this.onDocumentKeyDown, true);
      this.onDocumentKeyDown = null;
    }

    this.renderOptions();
  }

  /** Number keys pick a model; Escape closes. */
  private handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }

    if (this.view !== 'root') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!/^[1-9]$/.test(e.key)) return;

    const entries = this.getCatalog().latest;
    const entry = entries[Number(e.key) - 1];
    if (!entry) return;

    e.preventDefault();
    e.stopPropagation();
    void this.select(entry.value);
  }

  /** Applies a model choice and closes the menu. */
  private async select(value: string) {
    await this.callbacks.onModelChange(value);
    this.close();
    this.updateDisplay();
  }

  /** Removes document listeners; call when the view is torn down. */
  destroy() {
    this.close();
  }

  updateDisplay() {
    if (!this.buttonEl) return;
    const currentModel = this.callbacks.getSettings().model;
    const entry = findCatalogEntry(this.getCatalog(), currentModel);

    this.buttonEl.empty();

    const labelEl = this.buttonEl.createSpan({ cls: 'oc-model-label' });
    labelEl.setText(entry.label || currentModel || 'Unknown');
    this.buttonEl.setAttribute('title', entry.description || entry.value);
  }

  /**
   * Renders one model row.
   * `hint` is the number shortcut; the active row shows a check instead.
   */
  private renderOption(
    parentEl: HTMLElement,
    model: CatalogEntry,
    currentModel: string,
    hint?: string
  ) {
    const option = parentEl.createDiv({ cls: 'oc-model-option' });
    const isSelected = model.value === currentModel;
    if (isSelected) option.addClass('selected');

    option.createSpan({ cls: 'oc-model-option-label', text: model.label });
    option.setAttribute('title', model.description || model.value);

    const hintEl = option.createSpan({ cls: 'oc-model-option-hint' });
    if (isSelected) {
      hintEl.addClass('oc-model-option-check');
      setIcon(hintEl, 'check');
    } else if (hint) {
      hintEl.setText(hint);
    }

    option.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.select(model.value);
    });
  }

  renderOptions() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();

    const currentModel = this.callbacks.getSettings().model;
    const catalog = this.getCatalog();

    if (this.view === 'more') {
      this.renderMoreView(catalog, currentModel);
      return;
    }

    this.dropdownEl.createDiv({ cls: 'oc-model-menu-header', text: 'Models' });

    catalog.latest.forEach((model, index) => {
      this.renderOption(
        this.dropdownEl as HTMLElement,
        model,
        currentModel,
        index < 9 ? String(index + 1) : undefined
      );
    });

    if (catalog.previous.length === 0) return;

    this.dropdownEl.createDiv({ cls: 'oc-model-menu-divider' });

    const more = this.dropdownEl.createDiv({ cls: 'oc-model-option oc-model-more-row' });
    more.createSpan({ cls: 'oc-model-option-label', text: 'More models' });
    const chevron = more.createSpan({ cls: 'oc-model-option-hint' });
    setIcon(chevron, 'chevron-right');
    // A pinned selection lives in the submenu — mark the entry point so the
    // active model is never invisible from the root view.
    if (catalog.previous.some((m) => m.value === currentModel)) {
      more.addClass('has-selected');
    }
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.view = 'more';
      this.renderOptions();
    });
  }

  /** The "More models" submenu: pinned versions plus a manual refresh. */
  private renderMoreView(catalog: ModelCatalog, currentModel: string) {
    if (!this.dropdownEl) return;

    const back = this.dropdownEl.createDiv({ cls: 'oc-model-menu-header oc-model-menu-back' });
    const backIcon = back.createSpan({ cls: 'oc-model-back-icon' });
    setIcon(backIcon, 'chevron-left');
    back.createSpan({ text: 'Models' });
    back.addEventListener('click', (e) => {
      e.stopPropagation();
      this.view = 'root';
      this.renderOptions();
    });

    for (const model of catalog.previous) {
      this.renderOption(this.dropdownEl, model, currentModel);
    }

    if (!this.callbacks.onRefreshModels) return;

    this.dropdownEl.createDiv({ cls: 'oc-model-menu-divider' });

    const refresh = this.dropdownEl.createDiv({ cls: 'oc-model-refresh' });
    refresh.setText(this.isRefreshing ? '모델 목록 불러오는 중...' : '모델 목록 새로고침');
    refresh.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (this.isRefreshing) return;
      this.isRefreshing = true;
      this.renderOptions();
      try {
        const ok = await this.callbacks.onRefreshModels?.();
        new Notice(ok ? '✓ 모델 목록을 새로고침했습니다.' : '모델 목록을 가져오지 못했습니다.');
      } finally {
        this.isRefreshing = false;
        this.updateDisplay();
        this.renderOptions();
      }
    });
  }
}

/** Thinking budget selector component. */
export class ThinkingBudgetSelector {
  private container: HTMLElement;
  private gearsEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'oc-thinking-selector' });
    this.render();
  }

  private render() {
    this.container.empty();

    const labelEl = this.container.createSpan({ cls: 'oc-thinking-label-text' });
    labelEl.setText('Thinking:');

    this.gearsEl = this.container.createDiv({ cls: 'oc-thinking-gears' });
    this.renderGears();
  }

  private renderGears() {
    if (!this.gearsEl) return;
    this.gearsEl.empty();

    const currentBudget = this.callbacks.getSettings().thinkingBudget;
    const currentBudgetInfo = THINKING_BUDGETS.find(b => b.value === currentBudget);

    const currentEl = this.gearsEl.createDiv({ cls: 'oc-thinking-current' });
    currentEl.setText(currentBudgetInfo?.label || 'Off');

    const optionsEl = this.gearsEl.createDiv({ cls: 'oc-thinking-options' });

    for (const budget of [...THINKING_BUDGETS].reverse()) {
      const gearEl = optionsEl.createDiv({ cls: 'oc-thinking-gear' });
      gearEl.setText(budget.label);
      gearEl.setAttribute('title', budget.tokens > 0 ? `${budget.tokens.toLocaleString()} tokens` : 'Disabled');

      if (budget.value === currentBudget) {
        gearEl.addClass('selected');
      }

      gearEl.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.callbacks.onThinkingBudgetChange(budget.value);
        this.updateDisplay();
      });
    }
  }

  updateDisplay() {
    this.renderGears();
  }
}

/** Permission mode toggle (AUTO/Safe/Plan). */
export class PermissionToggle {
  private container: HTMLElement;
  private toggleEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private onPlanModeToggle: ((active: boolean) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'oc-permission-toggle' });
    this.render();
  }

  private render() {
    this.container.empty();

    this.labelEl = this.container.createSpan({ cls: 'oc-permission-label' });
    this.toggleEl = this.container.createDiv({ cls: 'oc-toggle-switch' });

    this.updateDisplay();

    // Cycle modes on click anywhere on the container
    this.container.addEventListener('click', () => this.toggle());
  }

  /** Set callback for plan mode toggle. */
  setOnPlanModeToggle(callback: (active: boolean) => void) {
    this.onPlanModeToggle = callback;
  }

  /** Set plan mode active state. */
  setPlanModeActive(_active: boolean) {
    this.updateDisplay();
  }

  /** Check if plan mode is active. */
  isPlanModeActive(): boolean {
    return this.isPlanModeLocked() || this.isPlanModeRequested();
  }

  private isPlanModeLocked(): boolean {
    return this.callbacks.getSettings().permissionMode === 'plan';
  }

  private isPlanModeRequested(): boolean {
    return this.callbacks.isPlanModeRequested?.() ?? false;
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) return;

    this.container.removeClass('plan-mode');
    this.labelEl.empty();

    const mode = this.callbacks.getSettings().permissionMode;

    if (mode === 'plan') {
      this.container.addClass('plan-mode');
      this.toggleEl.removeClass('active');

      const iconEl = this.labelEl.createSpan({ cls: 'oc-plan-mode-icon' });
      iconEl.textContent = '▎▎';
      iconEl.style.fontSize = '0.8em';
      iconEl.style.letterSpacing = '-4px';
      this.labelEl.createSpan({ text: 'Plan' });
    } else if (mode === 'yolo') {
      this.toggleEl.addClass('active');
      this.labelEl.setText('AUTO');
    } else {
      // Safe / Normal
      this.toggleEl.removeClass('active');
      this.labelEl.setText('Safe');
    }
  }

  private async toggle() {
    // Cycle: Auto (yolo) -> Plan -> Safe (normal)
    const current = this.callbacks.getSettings().permissionMode;
    let next: PermissionMode;

    if (current === 'yolo') {
      next = 'plan';
    } else if (current === 'plan') {
      next = 'normal';
    } else {
      next = 'yolo';
    }

    await this.callbacks.onPermissionModeChange(next);
    this.updateDisplay();
  }

  /** Toggle plan mode on/off. */
  async togglePlanMode() {
    if (this.isPlanModeLocked()) {
      new Notice('Plan mode is active until the plan is approved.');
      return;
    }
    const nextRequested = !this.isPlanModeRequested();
    this.onPlanModeToggle?.(nextRequested);
    this.updateDisplay();
  }
}

/** External context selector component (folder icon). */
export class ExternalContextSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  /** Session-specific external context paths (resets on new conversation). */
  private externalContextPaths: string[] = [];
  private onChangeCallback: ((paths: string[]) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'oc-external-context-selector' });
    this.render();
  }

  /** Set callback for when external context paths change. */
  setOnChange(callback: (paths: string[]) => void): void {
    this.onChangeCallback = callback;
  }

  /** Get current external context paths. */
  getExternalContexts(): string[] {
    return [...this.externalContextPaths];
  }

  /** Set external context paths (for restoring from conversation). */
  setExternalContexts(paths: string[]): void {
    this.externalContextPaths = [...paths];
    this.updateDisplay();
    this.renderDropdown();
  }

  /** Clear external context paths (call on new conversation). */
  clearExternalContexts(): void {
    this.externalContextPaths = [];
    this.updateDisplay();
    this.renderDropdown();
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'oc-external-context-icon-wrapper' });

    this.iconEl = iconWrapper.createDiv({ cls: 'oc-external-context-icon' });
    setIcon(this.iconEl, 'folder');

    this.badgeEl = iconWrapper.createDiv({ cls: 'oc-external-context-badge' });

    this.updateDisplay();

    // Click to open native folder picker
    iconWrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openFolderPicker();
    });

    this.dropdownEl = this.container.createDiv({ cls: 'oc-external-context-dropdown' });
    this.renderDropdown();
  }

  private async openFolderPicker() {
    try {
      // Access Electron's dialog through remote
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { remote } = require('electron');
      const result = await remote.dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select External Context',
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];

        // Check for duplicate
        if (this.externalContextPaths.includes(selectedPath)) {
          return;
        }

        // Check for nested/overlapping paths
        const conflict = findConflictingPath(selectedPath, this.externalContextPaths);
        if (conflict) {
          // Show warning notice
          this.showConflictNotice(selectedPath, conflict);
          return;
        }

        this.externalContextPaths = [...this.externalContextPaths, selectedPath];
        this.onChangeCallback?.(this.externalContextPaths);
        this.updateDisplay();
        this.renderDropdown();
      }
    } catch (err) {
      console.error('Failed to open folder picker:', err);
    }
  }

  /** Shows a notice when a conflicting path is detected. */
  private showConflictNotice(newPath: string, conflict: { path: string; type: 'parent' | 'child' }) {
    const shortNew = this.shortenPath(newPath);
    const shortExisting = this.shortenPath(conflict.path);

    let message: string;
    if (conflict.type === 'parent') {
      message = `Cannot add "${shortNew}" - it's inside existing path "${shortExisting}"`;
    } else {
      message = `Cannot add "${shortNew}" - it contains existing path "${shortExisting}"`;
    }

    new Notice(message, 5000);
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'oc-external-context-header' });
    headerEl.setText('External Contexts');

    // Path list
    const listEl = this.dropdownEl.createDiv({ cls: 'oc-external-context-list' });

    if (this.externalContextPaths.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'oc-external-context-empty' });
      emptyEl.setText('Click folder icon to add');
    } else {
      for (const pathStr of this.externalContextPaths) {
        const itemEl = listEl.createDiv({ cls: 'oc-external-context-item' });

        const pathTextEl = itemEl.createSpan({ cls: 'oc-external-context-text' });
        // Show shortened path for display
        const displayPath = this.shortenPath(pathStr);
        pathTextEl.setText(displayPath);
        pathTextEl.setAttribute('title', pathStr);

        const removeBtn = itemEl.createSpan({ cls: 'oc-external-context-remove' });
        setIcon(removeBtn, 'x');
        removeBtn.setAttribute('title', 'Remove path');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.externalContextPaths = this.externalContextPaths.filter(p => p !== pathStr);
          this.onChangeCallback?.(this.externalContextPaths);
          this.updateDisplay();
          this.renderDropdown();
        });
      }
    }
  }

  /** Shorten path for display (replace home dir with ~) */
  private shortenPath(fullPath: string): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const os = require('os');
      const homeDir = os.homedir();
      const normalize = (value: string) => value.replace(/\\/g, '/');
      const normalizedFull = normalize(fullPath);
      const normalizedHome = normalize(homeDir);
      const compareFull = process.platform === 'win32'
        ? normalizedFull.toLowerCase()
        : normalizedFull;
      const compareHome = process.platform === 'win32'
        ? normalizedHome.toLowerCase()
        : normalizedHome;
      if (compareFull.startsWith(compareHome)) {
        return '~' + fullPath.slice(homeDir.length);
      }
    } catch {
      // Fall back to full path
    }
    return fullPath;
  }

  updateDisplay() {
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.externalContextPaths.length;

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', `${count} external context${count > 1 ? 's' : ''} (click to add more)`);

      // Show badge only when more than 1 path
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', 'Add external contexts (click)');
      this.badgeEl.removeClass('visible');
    }
  }
}

/** MCP server selector component (plug icon). */
export class McpServerSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private mcpService: McpService | null = null;
  private enabledServers: Set<string> = new Set();
  private onChangeCallback: ((enabled: Set<string>) => void) | null = null;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'oc-mcp-selector' });
    this.render();
  }

  /** Set the MCP service for fetching server list. */
  setMcpService(service: McpService | null): void {
    this.mcpService = service;
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  /** Set callback for when enabled servers change. */
  setOnChange(callback: (enabled: Set<string>) => void): void {
    this.onChangeCallback = callback;
  }

  /** Get currently enabled servers (via click or @-mention). */
  getEnabledServers(): Set<string> {
    return new Set(this.enabledServers);
  }

  /** Add servers from @-mentions. */
  addMentionedServers(names: Set<string>): void {
    let changed = false;
    for (const name of names) {
      if (!this.enabledServers.has(name)) {
        this.enabledServers.add(name);
        changed = true;
      }
    }
    if (changed) {
      this.updateDisplay();
      this.renderDropdown();
    }
  }

  /** Clear enabled servers (call on new conversation). */
  clearEnabled(): void {
    this.enabledServers.clear();
    this.updateDisplay();
    this.renderDropdown();
  }

  /** Set enabled servers (call when restoring conversation state). */
  setEnabledServers(names: string[]): void {
    this.enabledServers = new Set(names);
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  private pruneEnabledServers(): void {
    if (!this.mcpService) return;
    const activeNames = new Set(this.mcpService.getServers().filter((s) => s.enabled).map((s) => s.name));
    let changed = false;
    for (const name of this.enabledServers) {
      if (!activeNames.has(name)) {
        this.enabledServers.delete(name);
        changed = true;
      }
    }
    if (changed) {
      this.onChangeCallback?.(this.enabledServers);
    }
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'oc-mcp-selector-icon-wrapper' });

    this.iconEl = iconWrapper.createDiv({ cls: 'oc-mcp-selector-icon' });
    this.iconEl.innerHTML = MCP_ICON_SVG;

    this.badgeEl = iconWrapper.createDiv({ cls: 'oc-mcp-selector-badge' });

    this.updateDisplay();

    this.dropdownEl = this.container.createDiv({ cls: 'oc-mcp-selector-dropdown' });
    this.renderDropdown();

    // Re-render dropdown content on hover (CSS handles visibility)
    this.container.addEventListener('mouseenter', () => {
      this.renderDropdown();
    });
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;
    this.pruneEnabledServers();
    this.dropdownEl.empty();

    // Header
    const headerEl = this.dropdownEl.createDiv({ cls: 'oc-mcp-selector-header' });
    headerEl.setText('MCP Servers');

    // Server list
    const listEl = this.dropdownEl.createDiv({ cls: 'oc-mcp-selector-list' });

    const allServers = this.mcpService?.getServers() || [];
    const servers = allServers.filter(s => s.enabled);

    if (servers.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'oc-mcp-selector-empty' });
      emptyEl.setText(allServers.length === 0 ? 'No MCP servers configured' : 'All MCP servers disabled');
      return;
    }

    for (const server of servers) {
      this.renderServerItem(listEl, server);
    }
  }

  private renderServerItem(listEl: HTMLElement, server: ObsidianCodeMcpServer) {
    const itemEl = listEl.createDiv({ cls: 'oc-mcp-selector-item' });
    itemEl.dataset.serverName = server.name;

    const isEnabled = this.enabledServers.has(server.name);
    if (isEnabled) {
      itemEl.addClass('enabled');
    }

    // Checkbox
    const checkEl = itemEl.createDiv({ cls: 'oc-mcp-selector-check' });
    if (isEnabled) {
      checkEl.innerHTML = CHECK_ICON_SVG;
    }

    // Info
    const infoEl = itemEl.createDiv({ cls: 'oc-mcp-selector-item-info' });

    const nameEl = infoEl.createSpan({ cls: 'oc-mcp-selector-item-name' });
    nameEl.setText(server.name);

    // Badges
    if (server.contextSaving) {
      const csEl = infoEl.createSpan({ cls: 'oc-mcp-selector-cs-badge' });
      csEl.setText('@');
      csEl.setAttribute('title', 'Context-saving: can also enable via @' + server.name);
    }

    // Click to toggle (use mousedown for more reliable capture)
    itemEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleServer(server.name, itemEl);
    });
  }

  private toggleServer(name: string, itemEl: HTMLElement) {
    if (this.enabledServers.has(name)) {
      this.enabledServers.delete(name);
    } else {
      this.enabledServers.add(name);
    }

    // Update item visually in-place (immediate feedback)
    const isEnabled = this.enabledServers.has(name);
    const checkEl = itemEl.querySelector('.oc-mcp-selector-check') as HTMLElement | null;

    if (isEnabled) {
      itemEl.addClass('enabled');
      if (checkEl) checkEl.innerHTML = CHECK_ICON_SVG;
    } else {
      itemEl.removeClass('enabled');
      if (checkEl) checkEl.innerHTML = '';
    }

    this.updateDisplay();
    this.onChangeCallback?.(this.enabledServers);
  }

  updateDisplay() {
    this.pruneEnabledServers();
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.enabledServers.size;
    const hasServers = (this.mcpService?.getServers().length || 0) > 0;

    // Show/hide container based on whether there are servers
    if (!hasServers) {
      this.container.style.display = 'none';
      return;
    }
    this.container.style.display = '';

    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', `${count} MCP server${count > 1 ? 's' : ''} enabled (click to manage)`);

      // Show badge only when more than 1
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
    } else {
      this.iconEl.removeClass('active');
      this.iconEl.setAttribute('title', 'MCP servers (click to enable)');
      this.badgeEl.removeClass('visible');
    }
  }
}

/** Factory function to create all toolbar components. */
export function createInputToolbar(
  parentEl: HTMLElement,
  callbacks: ToolbarCallbacks
): {
  modelSelector: ModelSelector;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  externalContextSelector: ExternalContextSelector;
  mcpServerSelector: McpServerSelector;
  permissionToggle: PermissionToggle;
} {
  const modelSelector = new ModelSelector(parentEl, callbacks);
  const thinkingBudgetSelector = new ThinkingBudgetSelector(parentEl, callbacks);
  const externalContextSelector = new ExternalContextSelector(parentEl, callbacks);
  const mcpServerSelector = new McpServerSelector(parentEl);
  const permissionToggle = new PermissionToggle(parentEl, callbacks);

  return { modelSelector, thinkingBudgetSelector, externalContextSelector, mcpServerSelector, permissionToggle };
}
