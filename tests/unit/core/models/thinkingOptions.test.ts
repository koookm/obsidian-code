import { applyThinkingOptions, getThinkingOptions } from '@/core/models/thinkingOptions';

describe('getThinkingOptions', () => {
  it('disables thinking when the budget is off', () => {
    expect(getThinkingOptions('off')).toEqual({ thinking: { type: 'disabled' } });
  });

  it('requests a fixed budget matching the selector levels', () => {
    expect(getThinkingOptions('low')).toEqual({
      thinking: { type: 'enabled', budgetTokens: 4000 },
      maxThinkingTokens: 4000,
    });
    expect(getThinkingOptions('medium').thinking).toEqual({ type: 'enabled', budgetTokens: 8000 });
    expect(getThinkingOptions('high').thinking).toEqual({ type: 'enabled', budgetTokens: 16000 });
    expect(getThinkingOptions('xhigh').thinking).toEqual({ type: 'enabled', budgetTokens: 32000 });
  });

  it('keeps the deprecated field alongside the new one for older CLI builds', () => {
    expect(getThinkingOptions('medium').maxThinkingTokens).toBe(8000);
  });

  it('omits the deprecated field when thinking is disabled', () => {
    expect(getThinkingOptions('off').maxThinkingTokens).toBeUndefined();
  });
});

describe('applyThinkingOptions', () => {
  it('writes both fields onto the SDK options', () => {
    const options: Record<string, unknown> = {};
    applyThinkingOptions(options, 'high');
    expect(options).toEqual({
      thinking: { type: 'enabled', budgetTokens: 16000 },
      maxThinkingTokens: 16000,
    });
  });

  it('sends an explicit disable rather than leaving the field unset', () => {
    const options: Record<string, unknown> = {};
    applyThinkingOptions(options, 'off');
    expect(options.thinking).toEqual({ type: 'disabled' });
    expect(options).not.toHaveProperty('maxThinkingTokens');
  });
});
