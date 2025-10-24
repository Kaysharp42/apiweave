# Variables and Data Passing

## Overview
APIWeave supports passing data between workflow nodes using a variable substitution system similar to Postman and Insomnia.

## Variable Syntax
Use double curly braces to reference variables: `{{variable.path}}`

## Accessing Previous Node Data
Use `prev.response` to access the last executed node's response:

### Response Body
```
{{prev.response.body.token}}
{{prev.response.body.user.id}}
{{prev.response.body.data[0].name}}
```

### Response Headers
```
{{prev.response.headers.content-type}}
{{prev.response.headers.x-api-key}}
```

### Response Cookies
```
{{prev.response.cookies.session}}
{{prev.response.cookies.user_id}}
```

## Usage Examples

### Example 1: Authentication Flow
**Node 1 - Login**
```
POST https://api.example.com/auth/login
Body:
{
  "username": "user@example.com",
  "password": "password123"
}
```
Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "userId": "12345"
}
```

**Node 2 - Get User Profile**
```
GET https://api.example.com/users/:userId
Path Variables:
userId={{prev.response.body.userId}}

Headers:
Authorization=Bearer {{prev.response.body.token}}
```

### Example 2: Query Parameters
```
GET https://api.example.com/users
Query Params:
page=1
limit=10
search={{prev.response.body.query}}
filter=active
```

### Example 3: Cookies
**Node 1 - Login** (sets cookies in response)

**Node 2 - Protected Endpoint**
```
GET https://api.example.com/protected
Cookies:
session={{prev.response.cookies.session}}
user_token={{prev.response.cookies.user_token}}
```

### Example 4: Path Variables
```
GET https://api.example.com/teams/:teamId/members/:memberId
Path Variables:
teamId={{prev.response.body.team.id}}
memberId=12345
```

### Example 5: Dynamic Body
```
POST https://api.example.com/orders
Body:
{
  "productId": "{{prev.response.body.product.id}}",
  "quantity": 2,
  "userId": "{{prev.response.body.user.id}}",
  "authToken": "{{prev.response.body.token}}"
}
```

## Input Formats

### Query Parameters
One per line, `key=value` format:
```
page=1
limit=10
search={{prev.response.body.query}}
```

### Path Variables
One per line, `key=value` format:
```
userId={{prev.response.body.id}}
teamId=123
```

### Headers
One per line, `key=value` format:
```
Content-Type=application/json
Authorization=Bearer {{prev.response.body.token}}
X-Custom-Header=value
```

### Cookies
One per line, `key=value` format:
```
session={{prev.response.cookies.session}}
user_id=12345
```

## Notes
- Variables are substituted at runtime during workflow execution
- If a variable path doesn't exist, the original placeholder is kept
- JSON responses are automatically parsed for easy access
- Variables work in: URL, Query Params, Path Variables, Headers, Cookies, and Body
