import { vi } from 'vitest';
import { createClackPrompt } from './prompt-clack.js';

// vi.mock factories are hoisted above every const — obtain the mocks via
// vi.hoisted so the factory closure sees them.
const { cancel, textMock, selectMock, confirmMock, noteMock } = vi.hoisted(() => ({
  cancel: Symbol('clack:cancel'),
  textMock: vi.fn(),
  selectMock: vi.fn(),
  confirmMock: vi.fn(),
  noteMock: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
  isCancel: (value: unknown) => value === cancel,
  text: (...args: unknown[]) => textMock(...args),
  select: (...args: unknown[]) => selectMock(...args),
  confirm: (...args: unknown[]) => confirmMock(...args),
  note: (...args: unknown[]) => noteMock(...args),
}));

describe('createClackPrompt', () => {
  it('maps text answers and forwards default/placeholder', async () => {
    textMock.mockResolvedValue('answer');
    const prompt = createClackPrompt();
    await expect(prompt.text('Q', { default: 'd', placeholder: 'p' })).resolves.toBe(
      'answer',
    );
    expect(textMock).toHaveBeenCalledWith({
      message: 'Q',
      defaultValue: 'd',
      placeholder: 'p',
    });
  });

  it('maps clack cancel to undefined', async () => {
    textMock.mockResolvedValue(cancel);
    await expect(createClackPrompt().text('Q')).resolves.toBeUndefined();
  });

  it('maps select options and values', async () => {
    selectMock.mockResolvedValue('b');
    const prompt = createClackPrompt();
    await expect(
      prompt.select('Pick', [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ]),
    ).resolves.toBe('b');
    expect(selectMock).toHaveBeenCalledWith({
      message: 'Pick',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    });
  });

  it('maps confirm with initial value', async () => {
    confirmMock.mockResolvedValue(true);
    await expect(createClackPrompt().confirm('Sure?', false)).resolves.toBe(true);
    expect(confirmMock).toHaveBeenCalledWith({ message: 'Sure?', initialValue: false });
  });

  it('maps note through', () => {
    createClackPrompt().note('message', 'title');
    expect(noteMock).toHaveBeenCalledWith('message', 'title');
  });
});
