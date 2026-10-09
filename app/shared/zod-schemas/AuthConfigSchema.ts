import { z } from "zod"

export const BearerAuthConfigSchema = z
  .object({ token: z.string() })
  .strict()

export const BasicAuthConfigSchema = z
  .object({ username: z.string(), password: z.string() })
  .strict()

export const ApiKeyAuthConfigSchema = z
  .object({ key: z.string(), value: z.string(), addTo: z.enum(["header", "query"]) })
  .strict()

/** `{{secrets.NAME}}` and nothing else, or empty while the field is unset. */
const SecretReferenceSchema = z
  .string()
  .regex(/^(\{\{\s*secrets\.[A-Za-z_][A-Za-z0-9_]*\s*\}\})?$/, 'Must be a secret reference such as "{{secrets.CLIENT_SECRET}}", never the value itself.')

export const OAuth2AuthConfigSchema = z
  .object({
    grantType: z
      .enum(["client_credentials", "authorization_code"])
      .describe('"client_credentials" runs headless (app and CLI). "authorization_code" (with PKCE) needs the user to sign in once with Get token in the app.'),
    tokenUrl: z.string().describe("Token endpoint. Placeholders are substituted."),
    authorizationUrl: z.string().optional().describe("authorization_code only: the authorization endpoint opened in the browser."),
    clientId: z.string(),
    clientSecret: SecretReferenceSchema.optional().describe(
      'A "{{secrets.NAME}}" reference — a literal is rejected. Required for client_credentials; optional (confidential clients) for authorization_code.',
    ),
    scope: z.string().optional().describe("Space-separated scopes."),
    audience: z.string().optional().describe("Sent as the `audience` parameter when set (Auth0 and similar)."),
    clientAuth: z
      .enum(["basic", "body"])
      .optional()
      .describe('How the client authenticates to the token endpoint: an HTTP Basic header ("basic", the default) or client_id/client_secret form fields ("body").'),
    tokenSecret: SecretReferenceSchema.optional().describe(
      'authorization_code only: the "{{secrets.NAME}}" secret Get token stores the access and refresh token in. In the CLI, set that secret to a refresh token.',
    ),
  })
  .strict()

export const AwsSigV4AuthConfigSchema = z
  .object({
    accessKeyId: z.string().describe("The access key ID. Placeholders are substituted."),
    secretAccessKey: SecretReferenceSchema.describe('A "{{secrets.NAME}}" reference to the secret access key — a literal is rejected.'),
    sessionToken: SecretReferenceSchema.optional().describe('Temporary credentials: a "{{secrets.NAME}}" reference to the session token, sent as X-Amz-Security-Token.'),
    region: z.string().describe('The region, e.g. "us-east-1". Placeholders are substituted.'),
    service: z.string().describe('The signing name of the service, e.g. "execute-api", "s3", "lambda". Placeholders are substituted.'),
  })
  .strict()

export const DigestAuthConfigSchema = z
  .object({
    username: z.string().describe("Placeholders are substituted."),
    password: SecretReferenceSchema.describe('A "{{secrets.NAME}}" reference to the password — a literal is rejected.'),
  })
  .strict()

/** Longest `expiresInSeconds`: a day. A test token has no business living longer. */
export const MAX_JWT_LIFETIME_SECONDS = 86_400

export const JwtAuthConfigSchema = z
  .object({
    algorithm: z.enum(["HS256", "RS256", "ES256"]),
    secret: SecretReferenceSchema.describe(
      'A "{{secrets.NAME}}" reference to the signing key — a literal is rejected: the shared secret for HS256, a PEM private key (RSA for RS256, P-256 EC for ES256) otherwise.',
    ),
    payload: z
      .string()
      .describe('The claims as JSON object TEXT. Placeholders are substituted JSON-aware. "iat" is added (now) unless set, and "exp" when expiresInSeconds is set.'),
    header: z.string().optional().describe('Extra JOSE header fields as JSON object text, e.g. "{\"kid\": \"key-1\"}". "alg" is always the algorithm.'),
    expiresInSeconds: z.number().int().min(1).max(MAX_JWT_LIFETIME_SECONDS).optional().describe("Adds exp = iat + this many seconds, unless the payload sets exp."),
    headerName: z.string().optional().describe('The header the token is sent in. Defaults to "Authorization".'),
    prefix: z.string().optional().describe('Written before the token, followed by a space. Defaults to "Bearer"; empty sends the bare token.'),
  })
  .strict()

export const AuthConfigSchema = z
  .object({
    type: z.enum(["none", "bearer", "basic", "apiKey", "oauth2", "awsSigV4", "digest", "jwt"]),
    bearer: BearerAuthConfigSchema.optional(),
    basic: BasicAuthConfigSchema.optional(),
    apiKey: ApiKeyAuthConfigSchema.optional(),
    oauth2: OAuth2AuthConfigSchema.optional(),
    awsSigV4: AwsSigV4AuthConfigSchema.optional().describe(
      "Signs the final request (after the pre-request script) with AWS Signature Version 4, on every attempt. A signed request does not follow redirects.",
    ),
    digest: DigestAuthConfigSchema.optional().describe(
      "HTTP Digest (RFC 7616, MD5 or SHA-256, qop=auth): the request is sent, and answered once more with credentials when the server challenges it with a 401. Does not follow redirects.",
    ),
    jwt: JwtAuthConfigSchema.optional().describe("Signs a fresh JWT for every request and sends it as a bearer token (or in another header). The signed token is masked in results."),
  })
  .strict()
