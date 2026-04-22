/**
 * ObsidianCode - Message meta renderer
 *
 * Appends a collapsible meta badge (model, token counts, cache reads,
 * elapsed time) to the bottom of an assistant message element. Meant
 * to be called from the stream controller once usage data is known.
 */

export interface MessageMeta {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  elapsedMs: number;
}

export class MessageMetaRenderer {
  static render(messageWrapperEl: HTMLElement, meta: MessageMeta): void {
    const wrapper = messageWrapperEl.createDiv({ cls: 'oc-message-meta' });
    const toggle = wrapper.createEl('button', {
      cls: 'oc-message-meta-toggle',
      text: '▸',
    });
    const detail = wrapper.createDiv({ cls: 'oc-message-meta-detail' });
    detail.style.display = 'none';

    const parts: string[] = [
      meta.model,
      `↑${meta.inputTokens.toLocaleString()} ↓${meta.outputTokens.toLocaleString()} tok`,
    ];
    if (meta.cacheReadTokens) {
      parts.push(`📦 ${meta.cacheReadTokens.toLocaleString()}`);
    }
    parts.push(`${(meta.elapsedMs / 1000).toFixed(1)}s`);
    detail.textContent = parts.join(' │ ');

    toggle.addEventListener('click', () => {
      const collapsed = detail.style.display === 'none';
      detail.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? '▾' : '▸';
    });
  }
}
