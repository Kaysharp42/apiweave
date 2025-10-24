# Workflow Variables Implementation Guide

## 🎯 Overview

The Workflow Variables system allows you to:
- **Extract values** from API responses (tokens, IDs, session data, etc.)
- **Store them** as workflow-level variables that persist across all nodes
- **Reference them** anywhere in the workflow using `{{variables.varName}}` syntax
- **Manage them** through a dedicated Variables Panel UI

## 📋 Key Features

### 1. **Store Response Fields As Variables**
In any HTTP Request node, you can extract values from the response and save them as variables:

```
Variable Name: token
Path: response.body.token
```

This extracts the `token` field from the API response body and stores it as a workflow variable.

### 2. **Reference Variables**
Use extracted variables anywhere in the workflow:

```
URL: https://api.example.com/users
Headers:
  Authorization: Bearer {{variables.token}}
```

### 3. **Variables Panel**
On the right side of the workflow canvas, the Variables Panel displays:
- All current workflow variables
- Their values
- Edit and delete capabilities
- Usage hints

## 🔧 Implementation Details

### Backend (`backend/app/runner/executor.py`)

#### Key Changes:

**1. Workflow Variables Initialization**
```python
class WorkflowExecutor:
    def __init__(self, run_id: str, workflow_id: str):
        self.workflow_variables = {}  # New: stores workflow-level variables
    
    async def execute(self):
        # Load workflow variables from the workflow definition
        self.workflow_variables = workflow.get('variables', {}).copy()
```

**2. Enhanced Variable Substitution**
```python
def _substitute_variables(self, text: str) -> str:
    # Supports both:
    # - {{prev.response.body.token}}  (previous node data)
    # - {{variables.token}}            (workflow variables)
```

**3. Variable Extraction**
```python
def _extract_variables(self, extractors: Dict[str, str], response: Dict):
    """
    Extract values from response and store as workflow variables
    
    Example:
    extractors = {
        "token": "response.body.token",
        "userId": "response.body.user.id",
        "sessionId": "response.cookies.session"
    }
    """
```

**4. Execution Flow**
When an HTTP request is executed:
1. Node executes and gets response
2. If `extractors` config exists, `_extract_variables()` is called
3. Values are extracted from the response and stored in `self.workflow_variables`
4. Variables persist for subsequent nodes

### Frontend (`frontend/src/components/`)

#### 1. HTTPRequestNode.jsx
Added "Store Response Fields As Variables" section:
- Display current extractors
- Add new extractors with variable name and path
- Delete extractors
- Updated variable hints to show `{{variables.varName}}` syntax

#### 2. VariablesPanel.jsx (New Component)
Complete panel for managing workflow variables:
- View all variables
- Add new variables manually
- Edit existing variables
- Delete variables
- Shows usage syntax for each variable

#### 3. Workspace.jsx
Integrated VariablesPanel as a right pane:
- Uses Allotment for resizable layout
- Canvas on left, Variables Panel on right
- Panel updates workflow state
- Changes persist when workflow is saved

#### 4. WorkflowCanvas.jsx
Updated to:
- Load variables from workflow on mount
- Save variables when workflow is saved
- Pass variables to VariablesPanel

## 📝 Usage Examples

### Example 1: Login Token Flow

**Step 1: Login API Node**
```
Method: POST
URL: https://api.example.com/auth/login
Body: {"email": "user@example.com", "password": "pass123"}

Store Result As:
  Variable Name: token
  Path: response.body.token
```

**Step 2: Get User Data Node**
```
Method: GET
URL: https://api.example.com/users/me
Headers:
  Authorization: Bearer {{variables.token}}
```

The token extracted in Step 1 is automatically available in Step 2!

### Example 2: Multi-level Token Extraction

**Login Response:**
```json
{
  "accessToken": "abc123xyz",
  "refreshToken": "def456uvw",
  "user": {
    "id": "user123",
    "email": "user@example.com"
  }
}
```

**Store Multiple Variables:**
```
Extractor 1:
  Variable Name: accessToken
  Path: response.body.accessToken

Extractor 2:
  Variable Name: userId
  Path: response.body.user.id

Extractor 3:
  Variable Name: refreshToken
  Path: response.body.refreshToken
```

**Use in Subsequent Nodes:**
```
Headers:
  Authorization: Bearer {{variables.accessToken}}
  X-User-ID: {{variables.userId}}
  X-Refresh: {{variables.refreshToken}}
```

### Example 3: Extracting from Headers and Cookies

**Extractors:**
```
Extractor 1:
  Variable Name: sessionId
  Path: response.cookies.session

Extractor 2:
  Variable Name: contentType
  Path: response.headers.content-type
```

## 🎨 Variable Paths (Extractors)

### Path Format
Paths navigate through the response object using dot notation with support for array indexing.

### Common Paths

| Path | Description |
|------|-------------|
| `response.body.token` | JSON field in response body |
| `response.body.user.id` | Nested JSON field |
| `response.body.data[0].id` | Array element (0-indexed) |
| `response.body.nested.array[0].item[1].value` | Complex nesting |
| `response.headers.content-type` | Response header |
| `response.cookies.session` | Response cookie |
| `response.statusCode` | HTTP status code |

### Array Indexing
Arrays are **0-indexed** (like most programming languages):
```
response.body.items[0]  → First item
response.body.items[1]  → Second item
response.body.items[2]  → Third item
```

## 🔄 Variable Lifecycle

1. **Initialization**: Workflow loads with empty or pre-populated variables
2. **Extraction**: Each node can extract values and update variables
3. **Reference**: Subsequent nodes use variables via `{{variables.varName}}`
4. **Persistence**: Variables remain throughout the entire workflow execution
5. **Save**: Variables are saved with the workflow configuration

## 🛠️ Database Schema Update

### Workflow Document
```javascript
{
  workflowId: "uuid",
  name: "My API Flow",
  variables: {
    "token": "initial_token_value",
    "baseUrl": "https://api.example.com",
    "userId": "user123"
  },
  nodes: [...],
  edges: [...]
}
```

### Node Configuration (HTTP Request)
```javascript
{
  nodeId: "http-1",
  type: "http-request",
  config: {
    method: "POST",
    url: "https://api.example.com/login",
    headers: "Content-Type=application/json",
    body: "{...}",
    extractors: {
      "token": "response.body.token",
      "refreshToken": "response.body.refreshToken"
    }
  }
}
```

## ✅ Best Practices

### 1. **Use Clear Variable Names**
```
✅ Good:  accessToken, userId, sessionId
❌ Bad:   token1, temp, data
```

### 2. **Extract in Logical Steps**
```
Step 1: Login → Extract token
Step 2: Get profile → Use token
Step 3: Update data → Use token
```

### 3. **Handle Missing Values**
If a path doesn't exist, the extractor will skip it (no error).
Consider having default values in Variables Panel.

### 4. **Document Variable Usage**
Use descriptive paths that make sense:
```
accessToken: "response.body.accessToken"  (Clear)
token: "response.body.0.data.token"       (Complex, needs docs)
```

### 5. **Test Extraction**
Always verify the response structure:
1. Make the request manually
2. Examine the response
3. Build the correct path

## 🐛 Debugging Variables

### Enable Logging
The backend logs when variables are extracted:
```
✅ Extracted variable: token = abc123xyz
⚠️  Cannot extract sessionId: index out of range
❌ Error extracting variable userId from response.body.user.id: KeyError
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Variable not set | Wrong path | Check response structure |
| {{variables.name}} shows as literal | Not substituted | Verify it's in a substitutable field (URL, Headers, Body) |
| Empty variable value | Extracted value is null | Check if path exists in response |
| Old values persist | Cache issue | Reload workflow |

## 🔐 Security Considerations

- ⚠️ **Token Storage**: Tokens are stored in MongoDB. Ensure MongoDB is secured.
- ⚠️ **Sensitive Data**: Don't log sensitive variables in console.
- ⚠️ **Export**: Workflow exports include variable values - be careful when sharing.
- ✅ **Best Practice**: Use environment variables for initial secrets, extract API-provided tokens.

## 📚 Example Workflows

### OAuth2 Flow
1. Request token from OAuth provider
2. Extract `access_token`
3. Use token to authenticate subsequent API calls

### Multi-step API Chain
1. Login → Extract `token`
2. Create resource → Extract `resourceId`
3. Get resource → Use both `token` and `resourceId`
4. Update resource → Use all extracted values

### Data Aggregation
1. Fetch user list → Extract user IDs
2. For each user, fetch details using extracted IDs
3. Aggregate results

## 🚀 Future Enhancements

- [ ] Conditional variable assignment (if-then)
- [ ] Array operations (map, filter)
- [ ] Variable transformation functions
- [ ] Environment variable import
- [ ] Secret variable encryption
- [ ] Variable validation rules
- [ ] Variable templates/presets

---

**Last Updated**: 2025-10-24
**Version**: 1.0
