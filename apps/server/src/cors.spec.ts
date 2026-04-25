import { buildCorsOriginValidator } from './cors';

function check(
  validator: ReturnType<typeof buildCorsOriginValidator>,
  origin: string | undefined,
): boolean {
  let allowed = false;
  let error: Error | null = null;
  validator(origin, (err, ok) => {
    error = err;
    allowed = !!ok;
  });
  return error === null && allowed;
}

describe('CORS origin validator', () => {
  it('allows requests with no Origin header (curl, server-to-server)', () => {
    const v = buildCorsOriginValidator({ allowedOrigins: [], isProd: true });
    expect(check(v, undefined)).toBe(true);
  });

  it('allows any chrome-extension:// origin (extension is the primary client and IDs differ per build)', () => {
    const v = buildCorsOriginValidator({ allowedOrigins: [], isProd: true });
    expect(check(v, 'chrome-extension://abcdefghijklmnop')).toBe(true);
    expect(check(v, 'chrome-extension://other-id')).toBe(true);
  });

  it('allows origins in CORS_ORIGINS', () => {
    const v = buildCorsOriginValidator({
      allowedOrigins: ['https://app.example.com'],
      isProd: true,
    });
    expect(check(v, 'https://app.example.com')).toBe(true);
  });

  it('rejects unknown origins in production', () => {
    const v = buildCorsOriginValidator({
      allowedOrigins: ['https://app.example.com'],
      isProd: true,
    });
    expect(check(v, 'https://evil.example.com')).toBe(false);
    expect(check(v, 'http://localhost:3000')).toBe(false);
  });

  it('allows localhost only when not production', () => {
    const dev = buildCorsOriginValidator({ allowedOrigins: [], isProd: false });
    expect(check(dev, 'http://localhost:3000')).toBe(true);
    expect(check(dev, 'http://localhost')).toBe(true);
    expect(check(dev, 'https://localhost:5173')).toBe(true);

    const prod = buildCorsOriginValidator({ allowedOrigins: [], isProd: true });
    expect(check(prod, 'http://localhost:3000')).toBe(false);
  });
});
