import { HealthRunner, newFindings, worstStatus } from '@/core/health/HealthRunner';
import type { Probe, ProbeResult, ProbeStatus, VaultSnapshot } from '@/core/health/types';

function stubProbe(id: string, result: Partial<ProbeResult>): Probe {
  return {
    id,
    description: id,
    run: (): ProbeResult => ({
      probeId: id,
      status: 'healthy',
      findings: [],
      filesChecked: 0,
      ...result,
    }),
  };
}

const empty: VaultSnapshot = { files: [] };

describe('worstStatus', () => {
  it.each<[ProbeStatus[], ProbeStatus]>([
    [[], 'healthy'],
    [['healthy', 'healthy'], 'healthy'],
    [['healthy', 'degraded'], 'degraded'],
    [['degraded', 'failed'], 'failed'],
  ])('reduces %p to %p', (input, expected) => {
    expect(worstStatus(input)).toBe(expected);
  });
});

describe('HealthRunner', () => {
  it('aggregates to the worst probe status', () => {
    const runner = new HealthRunner([
      stubProbe('a', { status: 'healthy' }),
      stubProbe('b', { status: 'degraded' }),
    ]);

    const report = runner.run(empty, 42);

    expect(report.status).toBe('degraded');
    expect(report.ranAt).toBe(42);
    expect(report.results.map((r) => r.probeId)).toEqual(['a', 'b']);
  });

  it('reports healthy with no probes', () => {
    expect(new HealthRunner([]).run(empty, 1).status).toBe('healthy');
  });

  it('turns a throwing probe into a failed result rather than losing the run', () => {
    const boom: Probe = {
      id: 'boom',
      description: 'boom',
      run: () => {
        throw new Error('kaboom');
      },
    };

    const report = new HealthRunner([boom, stubProbe('ok', {})]).run(empty, 1);

    expect(report.status).toBe('failed');
    expect(report.results[0]).toMatchObject({ probeId: 'boom', status: 'failed' });
    expect(report.results[0].findings[0].message).toContain('kaboom');
    expect(report.results[1].probeId).toBe('ok');
  });
});

describe('newFindings', () => {
  const before = new HealthRunner([
    stubProbe('a', {
      status: 'degraded',
      findings: [{ path: 'old.md', message: 'Unresolved link: [[x]]', target: 'x' }],
    }),
  ]).run(empty, 1);

  it('returns only findings the change introduced', () => {
    const after = new HealthRunner([
      stubProbe('a', {
        status: 'degraded',
        findings: [
          { path: 'old.md', message: 'Unresolved link: [[x]]', target: 'x' },
          { path: 'new.md', message: 'Unresolved link: [[y]]', target: 'y' },
        ],
      }),
    ]).run(empty, 2);

    expect(newFindings(before, after)).toEqual([
      { probeId: 'a', path: 'new.md', message: 'Unresolved link: [[y]]', target: 'y' },
    ]);
  });

  it('returns nothing when the change fixed findings', () => {
    const after = new HealthRunner([stubProbe('a', { status: 'healthy' })]).run(empty, 2);
    expect(newFindings(before, after)).toEqual([]);
  });

  it('treats a finding from a different probe as new', () => {
    const after = new HealthRunner([
      stubProbe('b', {
        status: 'degraded',
        findings: [{ path: 'old.md', message: 'Unresolved link: [[x]]', target: 'x' }],
      }),
    ]).run(empty, 2);

    expect(newFindings(before, after)).toHaveLength(1);
    expect(newFindings(before, after)[0].probeId).toBe('b');
  });
});
