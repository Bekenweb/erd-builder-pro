import { describe, expect, it } from 'vitest';
import { isPendingFlowchartTarget } from '../pending-flowchart';

describe('isPendingFlowchartTarget', () => {
  it('applies pending AI content only to the chosen flowchart', () => {
    expect(isPendingFlowchartTarget({ id: 9, uid: null }, '9')).toBe(true);
    expect(isPendingFlowchartTarget({ id: 10, uid: 'abc' }, 'abc')).toBe(true);
    expect(isPendingFlowchartTarget({ id: 8, uid: 'other' }, 'abc')).toBe(false);
  });
  it('lets the next opened flowchart take untargeted content, but never a missing one', () => {
    expect(isPendingFlowchartTarget({ id: 3 }, null)).toBe(true);
    expect(isPendingFlowchartTarget(null, null)).toBe(false);
  });
});
