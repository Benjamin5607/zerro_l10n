import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function getHealth() {
  try {
    const base = process.env.ZERRO_L10N_BASE_URL || `http://localhost:${process.env.ZERRO_L10N_PORT || '4310'}`;
    const res = await fetch(`${base}/api/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const health = await getHealth();

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: '100%',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '2rem',
        }}
      >
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.75rem', color: 'var(--teal)' }}>
          Zerro L10n
        </h1>
        <p style={{ margin: '0 0 1.5rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          Localization TMS service — CAT editor, TM, glossary, QA, and AI translate/review via
          ZeroAI plugin contract.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <Link
            href="/embed"
            style={{
              display: 'inline-block',
              padding: '0.6rem 1.2rem',
              background: 'var(--teal)',
              color: '#042f2e',
              borderRadius: 8,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Open CAT Editor
          </Link>
          <Link
            href="/api/health"
            style={{
              display: 'inline-block',
              padding: '0.6rem 1.2rem',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              borderRadius: 8,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Health API
          </Link>
        </div>

        <section
          style={{
            padding: '1rem',
            background: 'var(--bg)',
            borderRadius: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85rem',
          }}
        >
          <div style={{ color: 'var(--muted)', marginBottom: '0.5rem' }}>Service health</div>
          {health ? (
            <pre style={{ margin: 0, color: 'var(--success)' }}>{JSON.stringify(health, null, 2)}</pre>
          ) : (
            <p style={{ margin: 0, color: 'var(--warning)' }}>
              Unavailable — run <code>npm run dev</code> to start on port{' '}
              {process.env.ZERRO_L10N_PORT || '4310'}.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
