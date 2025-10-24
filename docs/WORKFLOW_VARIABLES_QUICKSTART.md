# Workflow Variables - Quick Start Guide

## What Are Workflow Variables?

Workflow variables are **persistent values** that:
- Are extracted from API response data
- Persist throughout the entire workflow execution
- Can be referenced in any subsequent node
- Are stored at the workflow level (not per-node)

Perfect for: **Tokens, IDs, Session data, API keys, Authentication data**

## Quick Example

### Scenario: Login then Call Protected API

**Node 1: Login API**
```
POST https://api.example.com/login
Body: {"email": "user@example.com", "password": "secret"}

Store Result As:
  Variable Name: token
  Path: response.body.token
```

**Node 2: Get User Data**
```
GET https://api.example.com/users/me
Headers:
  Authorization: Bearer {{variables.token}}
```

That's it! The token from Node 1 is automatically available in Node 2.

## How to Use

### Step 1: Extract a Variable
In any HTTP Request node:
1. Expand the node (click ▶)
2. Scroll down to "Store Response Fields As Variables"
3. Enter:
   - **Variable Name**: What you'll call it (e.g., `token`, `userId`)
   - **Path**: Where to find it in the response (e.g., `response.body.token`)
4. Click "Add Extractor"

### Step 2: Use the Variable
In any node field (URL, Headers, Body, etc.):
```
{{variables.variableName}}
```

Example:
```
Authorization: Bearer {{variables.token}}
X-User-ID: {{variables.userId}}
```

### Step 3: Manage Variables
On the right side, you'll see the **Variables Panel**:
- See all current variables
- Edit values manually
- Delete variables
- View usage syntax

## Common Paths

| What | Path |
|------|------|
| JSON field | `response.body.fieldName` |
| Nested field | `response.body.user.id` |
| Array element | `response.body.items[0].id` |
| Deep nested | `response.body.data[0].user[0].token` |
| Response header | `response.headers.x-token` |
| Response cookie | `response.cookies.session` |
| Status code | `response.statusCode` |

## Real-World Examples

### OAuth2 Flow
```
1. Request access token
   Extract: token → response.body.access_token

2. Request user profile
   Use: Authorization: Bearer {{variables.token}}
   Extract: userId → response.body.id

3. List user resources
   Use: Authorization: Bearer {{variables.token}}
        X-User-ID: {{variables.userId}}
```

### Multi-Step API Chain
```
1. Create order
   Extract: orderId → response.body.orderId

2. Add items to order
   Use URL: /orders/{{variables.orderId}}/items

3. Get order status
   Use URL: /orders/{{variables.orderId}}/status
   Extract: status → response.body.status

4. Submit order
   Use URL: /orders/{{variables.orderId}}/submit
   Body: {"status": "{{variables.status}}"}
```

### Session Management
```
1. Login
   Extract: sessionId → response.cookies.session
            token → response.body.token

2. Every subsequent request
   Headers:
     Cookie: session={{variables.sessionId}}
     Authorization: Bearer {{variables.token}}
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Variable not showing in panel | Check extractor path is correct |
| {{variables.name}} shows literally | Ensure field is substitutable (URL, headers, body) |
| Old value persists | Reload workflow from database |
| Can't find the path | Check actual response in execution result |
| Multiple extractors from same node | Add multiple extractors with different names |

## Tips

✅ **Do:**
- Use descriptive variable names: `accessToken`, `userId`, `sessionId`
- Check response structure before writing paths
- Test extraction in practice runs
- Document complex workflows

❌ **Don't:**
- Use generic names: `data`, `temp`, `value1`
- Manually modify MongoDB variables
- Assume nested array indices without checking
- Store sensitive data you want to keep private

## File Reference

| File | Purpose |
|------|---------|
| `docs/WORKFLOW_VARIABLES.md` | Complete documentation |
| `frontend/src/components/VariablesPanel.jsx` | Variables UI component |
| `frontend/src/components/nodes/HTTPRequestNode.jsx` | Extractor UI |
| `backend/app/runner/executor.py` | Variable execution logic |

## Next Steps

1. Create a new workflow
2. Add a Login HTTP node
3. Set up extractors to capture the token
4. Add a second API node
5. Use `{{variables.token}}` in headers
6. Run the workflow
7. Watch the variables appear in the Variables Panel!

---

**Version**: 1.0  
**Last Updated**: 2025-10-24  
**For detailed docs**: See `docs/WORKFLOW_VARIABLES.md`
