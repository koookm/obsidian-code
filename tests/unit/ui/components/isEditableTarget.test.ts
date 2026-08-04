import { isEditableTarget } from '@/ui/components/InputToolbar';

/**
 * The model menu binds 1-9 as selection shortcuts on a capture-phase document
 * listener. This predicate is what keeps it from swallowing a digit the user is
 * typing into the chat input.
 */
describe('isEditableTarget', () => {
  const el = (tagName: string, isContentEditable = false) =>
    ({ tagName, isContentEditable }) as unknown as EventTarget;

  it('treats form fields as editable', () => {
    expect(isEditableTarget(el('INPUT'))).toBe(true);
    expect(isEditableTarget(el('TEXTAREA'))).toBe(true);
    expect(isEditableTarget(el('SELECT'))).toBe(true);
  });

  it('matches the tag name case-insensitively', () => {
    expect(isEditableTarget(el('textarea'))).toBe(true);
  });

  it('treats contenteditable hosts as editable', () => {
    expect(isEditableTarget(el('DIV', true))).toBe(true);
  });

  it('leaves plain elements alone so the shortcuts still fire', () => {
    expect(isEditableTarget(el('DIV'))).toBe(false);
    expect(isEditableTarget(el('BODY'))).toBe(false);
  });

  it('handles a missing or non-element target', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});
