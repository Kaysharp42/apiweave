# Migrate from Postman

*How to bring a Postman collection, and its environment, into APIWeave as a project, and exactly what each part of the collection becomes. For anyone moving their API tests off Postman.*

## Prerequisites

- A collection exported from Postman as **Collection v2.1** (in Postman: the collection's **…** menu → **Export** → **Collection v2.1**). Collection v1 and v2.0 files are refused with a message asking you to re-export.
- Optionally, a Postman environment export (the environment's **…** menu → **Export**).
- An APIWeave workspace to import into.

## Import in the app

1. In the sidebar, open **Projects**, click **Import** and choose **Postman**.
2. Pick the collection file, and the environment file if you have one.
3. Leave **One workflow per request** off to get one workflow per folder (the default), or turn it on to get one workflow per request.
4. Click **Preview**. Nothing is written yet. The preview lists the workflows that will be created with their request counts, the environment, the **secrets to create**, and every warning about something that did not convert.
5. Change the project name if you want, then click **Import as new project**.
6. Create each listed secret in the workspace (see [Environments and Secrets](../features/environments-and-secrets.md)) with the value it had in Postman, then read the warnings and fix what they point at.

The import always creates a new project, one environment, and new workflows; nothing existing is changed. It happens in one transaction: it lands whole or not at all.

## Run a collection from the CLI

`apiweave run` takes a Postman collection directly and converts it the same way before running it, which makes it easy to try a migrated suite in CI before you switch:

```bash
apiweave run shop.postman_collection.json \
  --env-file staging.postman_environment.json --env "Postman: Staging"
```

A Postman environment passed to `--env-file` becomes the collection's environment. Secrets come from `APIWEAVE_SECRET_<NAME>` variables, `--secret` or `--secrets-file`, named as the app's preview lists them. The run refuses to start, exit code 2, and names any secret that is missing. See [Run Tests in CI](ci.md).

## What each part becomes

### Collection, folders and requests

| Postman | APIWeave |
|---|---|
| Collection | A project, named after the collection. The collection description becomes the project description. |
| Requests at the top level of the collection | One workflow named after the collection. |
| Folder | One workflow named after the folder, holding the folder's own requests in their Postman order, chained Start → request 1 → request 2 → … → End. The folder description becomes the workflow description. |
| Nested folder | Its own workflow, named with its path: `Orders / Admin`. A folder with no requests of its own makes no workflow. |
| **One workflow per request** | Each request becomes its own workflow, named with its folder path: `Orders / Admin / Export orders`. |
| Project order | Top-level requests first, then each folder followed by its subfolders, as they appear in Postman. |
| Saved responses (examples) | Not imported. |

### Requests

| Postman | APIWeave HTTP Request node |
|---|---|
| Name | Node label. |
| Method | Method. Methods other than GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS become GET, with a warning. |
| URL | URL, without its query string. |
| Query parameters | Query parameters. Disabled ones are skipped. |
| Path variables (`/orders/:orderId`) | The segment becomes `/orders/{orderId}` and the value goes in the node's path variables. |
| Headers | Headers. Disabled ones are skipped. |
| Request description | Not imported. |

### Bodies

| Postman body mode | APIWeave |
|---|---|
| none | No body. |
| raw, language JSON | Body type JSON. |
| raw, language Text, JavaScript, HTML or XML | Body type Raw, with a `Content-Type` header of `text/plain`, `application/javascript`, `text/html` or `application/xml` unless the request already sets one. |
| x-www-form-urlencoded | Body type `x-www-form-urlencoded`. Disabled fields are skipped. |
| form-data | Body type form-data with its text fields. **File fields are skipped** with a warning: add the file on the node. |
| GraphQL | APIWeave has no GraphQL body type, so it becomes the JSON body a GraphQL server expects: `{"query": "...", "variables": {...}}`. |
| binary (file) | Skipped, with a warning. |

### Auth

Auth is resolved the way Postman resolves it: a request without its own auth, or set to **Inherit auth from parent**, uses its folder's, then the parent folder's, then the collection's. **No Auth** at any level stops the inheritance.

| Postman auth | APIWeave auth |
|---|---|
| Bearer Token | Bearer. |
| Basic Auth | Basic. The username is kept; the password is a secret. |
| API Key | API key, in the header or the query string. |
| OAuth 2.0, Client Credentials | OAuth 2.0, client credentials: token URL, client ID, scope, audience and client authentication (header → Basic, body → Body). |
| OAuth 2.0, Authorization Code (with or without PKCE) | OAuth 2.0, authorization code with PKCE. Sign in once with **Get token** on the node. |
| OAuth 2.0, other grants (password, implicit) | Not supported: the requests are imported without auth, with a warning. |
| Any other type (Digest, Hawk, AWS Signature, NTLM, Akamai, JWT…) | Not supported: the requests are imported without auth, with a warning. |

The access token Postman saved with an OAuth 2.0 configuration is never imported.

### Credentials: always secret references

No credential value from the collection or the environment is ever stored in APIWeave by the import. Wherever one would land, the import writes a `{{secrets.NAME}}` reference instead and adds `NAME` to the **secrets to create**:

- A literal in a credential slot (a bearer token, a basic-auth password, an API key, an OAuth 2.0 client secret, an `Authorization` or other credential-named header, query parameter or form field, a credential-named key in a JSON body) becomes a new secret named after where it was found, such as `LOGIN_PASSWORD` or `API_KEY_OF_FOLDER_ORDERS`. The same literal used in several places becomes one secret. An `Authorization: Bearer …` header keeps its `Bearer ` prefix in front of the reference.
- A variable that a credential slot reads (`{{accessToken}}` as a bearer token), a variable whose name looks like a credential (`token`, `password`, `apiKey`, `client_secret`…), a variable whose value looks like one (a bearer token, a JWT), and every **secret**-type variable of the environment, becomes a secret named after the variable. Its value is dropped.
- A raw body that still holds a bearer token or JWT after that is withheld whole and replaced by one secret reference.

Values are never imported silently into the secret store: you create each listed secret yourself.

### Variables

Postman's `{{name}}` becomes one of APIWeave's placeholder namespaces:

| Postman variable | APIWeave |
|---|---|
| A collection variable, or an environment variable | `{{env.name}}`, in one environment the import creates: **Postman: \<environment name\>** when you import an environment file, **Postman: \<collection name\>** otherwise. It holds the collection variables overlaid with the environment's values (the environment wins, as in Postman). Every imported workflow selects it. Disabled variables are skipped. |
| A variable a credential reads, or a secret one | `{{secrets.name}}`, see above. |
| A variable a test script in the same workflow sets | `{{variables.name}}`, a workflow variable filled by an extractor (see Scripts). |
| A variable used but defined nowhere (a Postman global, or from an environment you did not import) | `{{env.name}}`, added to the environment with an empty value and a warning, for you to fill. |

Names are normalized to letters, digits and underscores (`base-url` becomes `base_url`), with a warning.

**Variables do not pass between workflows.** In Postman, a token a login request stores in the environment is visible to every later request in the run. In APIWeave, an extracted variable lives in the workflow that extracted it. A request in another workflow that reads a variable a script in a different folder sets reads the environment or secret of that name instead, and the import warns. Either keep the login and the requests that need it in one folder, or turn on **One workflow per request** and connect them with a [Call Workflow](../features/workflows-and-nodes.md) node.

### Dynamic variables

| Postman | APIWeave |
|---|---|
| `{{$guid}}`, `{{$randomUUID}}` | `{{uuid()}}` |
| `{{$timestamp}}` | `{{timestamp()}}` |
| `{{$isoTimestamp}}` | `{{iso_timestamp()}}` |
| `{{$randomInt}}` | `{{randomNumber(3)}}` (100 to 999, where Postman's is 0 to 1000) |
| `{{$randomEmail}}`, `{{$randomExampleEmail}}` | `{{randomEmail()}}` |
| `{{$randomAlphaNumeric}}` | `{{randomString(1)}}` |
| `{{$randomHexadecimal}}` | `{{randomHex(1)}}` |
| `{{$randomBoolean}}` | `{{randomChoice(true,false)}}` |
| Any other (`{{$randomFirstName}}`, `{{$randomCity}}`…) | Left as written, with a warning. Replace it with a value or a [dynamic function](../reference/dynamic-functions.md). |

### Scripts

The import does not convert scripts into APIWeave [scripts](../features/scripting.md): Postman's `pm.*` API is not APIWeave's `aw` API. It recognizes the common patterns of a request's **test** script and turns them into node settings:

| Postman test script | APIWeave |
|---|---|
| `pm.response.to.have.status(201)` | **Expected status** 201 on the node. |
| `pm.expect(pm.response.code).to.eql(201)` (or `.equal`, `.eq`) | **Expected status** 201. |
| `var jsonData = pm.response.json();` then `pm.environment.set("token", jsonData.data.token);` | An extractor `token` = `response.body.data.token`, so later requests in the workflow read `{{variables.token}}`. |
| `pm.collectionVariables.set(...)`, `pm.variables.set(...)`, `pm.globals.set(...)` with `pm.response.json().path` | The same extractor. |

A script made only of those patterns (wrapped in `pm.test(...)` or not) is fully converted and disappears. Anything else, a test script with other checks, every pre-request script, is kept word for word in a **Postman scripts** note on the workflow's canvas, with a warning, so you can rebuild it with [Assertion](../features/workflows-and-nodes.md) nodes and extractors, or port it by hand to the request's **Scripts** tab ([Coming from Postman](../features/scripting.md#coming-from-postman) maps the common `pm.*` calls). Collection-level scripts are kept in the project description and folder-level scripts in the folder's workflow description; neither is converted. A kept script that contains a bearer token, a JWT or a live API key is replaced by a line saying it was withheld, so a credential typed into a script does not reach APIWeave either.

## Troubleshooting

**"This is a Postman Collection v1 file" or "v2.0 file".** Re-export the collection from Postman as Collection v2.1.

**A request fails with 401 after import.** Create the secrets the preview listed. The import result lists the ones still missing in the workspace.

**A request sends `{{env.orderId}}` unresolved.** The variable had no value in the collection or the environment you imported. Set it in the **Postman: …** environment.

**A request that worked in Postman now reads an empty token.** The token is set by a script in another folder, and variables do not pass between workflows. See [Variables](#variables).

**"Secret substitution not allowed in URL".** A credential variable is used in the request URL path. APIWeave keeps secrets out of URLs; move the value to a header or a query parameter.

## Related

- [Projects](../features/projects.md): project export, import and runs.
- [Environments and Secrets](../features/environments-and-secrets.md): creating the listed secrets.
- [Variables and Extractors](../features/variables-and-extractors.md): the placeholder namespaces.
- [Run Tests in CI](ci.md): `apiweave run`.
