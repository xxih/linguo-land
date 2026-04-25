type Cb = (err: Error | null, allow?: boolean) => void;

export interface CorsValidatorOptions {
  allowedOrigins: string[];
  isProd: boolean;
}

export function buildCorsOriginValidator({
  allowedOrigins,
  isProd,
}: CorsValidatorOptions) {
  return (origin: string | undefined, cb: Cb) => {
    if (!origin) return cb(null, true);
    if (origin.startsWith('chrome-extension://')) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (!isProd && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  };
}
