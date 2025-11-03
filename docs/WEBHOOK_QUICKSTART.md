# Quick Start Guide - Testing Webhook Management

## 🚀 Quick Start (5 Minutes)

### Step 1: Configure Backend
```bash
# Add to backend/.env (if not already present)
echo "BASE_URL=http://localhost:8000" >> backend/.env
```

### Step 2: Start All Services
```bash
# Open the project root directory
cd apiweave

# Use the convenient start script
start-dev.bat

# This will open 4 terminal windows:
# 1. MongoDB (localhost:27017)
# 2. Backend API (localhost:8000)
# 3. Worker (background tasks)
# 4. Frontend (localhost:3000)
```

### Step 3: Access Webhook UI
1. Open browser: `http://localhost:3000`
2. Click the **Webhooks** icon (🔗) in the left navigation bar
3. You'll see the Webhook Manager interface

### Step 4: Create Your First Webhook

#### 4a. Create a Test Workflow (if you don't have one)
1. Click the **Workflows** icon (🏠) in navigation
2. Click **+ Create** button
3. Enter name: "My Test API Workflow"
4. Add some nodes to make it functional
5. Workflow will auto-save

#### 4b. Create a Webhook
1. Navigate back to **Webhooks** section
2. Click **+ Create Webhook** button
3. Fill in the form:
   - **Resource Type**: Workflow
   - **Workflow**: Select "My Test API Workflow"
   - **Environment**: Leave empty (optional)
   - **Description**: "My first webhook"
4. Click **Create**

#### 4c. Save Your Credentials ⚠️
A modal will appear showing:
- **Webhook URL**: Copy this
- **Token**: Copy this (X-Webhook-Token header)
- **HMAC Secret**: Copy this (for signature validation)
- **cURL Example**: Copy for testing

**⚠️ IMPORTANT**: These credentials are shown ONLY ONCE!

### Step 5: Test the Webhook

#### Test via API (Backend)
```bash
# Get webhook details (credentials NOT included)
curl http://localhost:8000/api/webhooks/wh-xxxxxxxxxxxx

# List all webhooks for your workflow
curl http://localhost:8000/api/webhooks/workflows/{your-workflow-id}

# View execution logs (empty for now)
curl http://localhost:8000/api/webhooks/wh-xxxxxxxxxxxx/logs
```

#### Test via UI (Frontend)
1. **Enable/Disable**: Click the green "Enabled" badge to toggle
2. **Copy URL**: Click the copy icon next to webhook URL
3. **View Logs**: Click "View Logs" button (currently empty)
4. **Regenerate**: Click "Regenerate" button to create new credentials
5. **Delete**: Click "Delete" button to remove webhook

### Step 6: Explore Features

#### Create Collection Webhook
1. Navigate to **Collections** section
2. Create a collection and add some workflows
3. Go back to **Webhooks** section
4. Create webhook with **Resource Type: Collection**

#### Test Webhook Status
1. Toggle any webhook to "Disabled"
2. Observe the badge color change from green to gray
3. Toggle back to "Enabled"

#### Regenerate Credentials
1. Click **Regenerate** on any webhook
2. Confirm the action
3. A modal will appear with new credentials
4. **Copy them immediately!**
5. Test old webhook URL - it should be invalidated

## 🎯 What Works Now

✅ **Fully Functional**:
- Create webhooks for workflows/collections
- List all webhooks
- View webhook details (no credentials after creation)
- Update webhook settings (environment, enabled, description)
- Regenerate credentials (shown once)
- Delete webhooks
- View execution logs (empty until execution implemented)
- Copy webhook URLs and credentials
- Toggle enabled/disabled status
- Dark mode support

🔜 **Coming Soon** (Days 3-4):
- Webhook execution (trigger workflow/collection runs)
- HMAC signature validation
- Token authentication
- Rate limiting
- Synchronous result polling

## 📊 API Documentation

Open Swagger UI for interactive API testing:
```
http://localhost:8000/docs
```

Navigate to **Webhooks** section to try all endpoints.

## 🐛 Troubleshooting

### Backend won't start
```bash
# Check if BASE_URL is in .env
cd backend
cat .env | grep BASE_URL

# If not, add it
echo "BASE_URL=http://localhost:8000" >> .env
```

### Frontend shows no webhooks
- Make sure you've created at least one workflow or collection
- Refresh the page
- Check browser console for errors

### Credentials modal not appearing
- Check browser console for errors
- Make sure backend is running on port 8000
- Try creating webhook via API directly

### Can't copy webhook URL
- Make sure clipboard permissions are enabled in browser
- Try right-click → Copy instead

## 📖 Complete Documentation

For detailed information, see:
- **Testing Guide**: `docs/WEBHOOK_TESTING_GUIDE.md`
- **Implementation Summary**: `docs/WEBHOOK_IMPLEMENTATION_SUMMARY.md`
- **Implementation Plan**: `docs/CI_CD_WEBHOOK_IMPLEMENTATION_PLAN.md`

## 🎓 Next Steps

After testing the webhook management UI:

1. ✅ **You are here**: Test webhook CRUD operations
2. 🔜 **Day 3**: Implement authentication & security
3. 🔜 **Day 4**: Implement webhook execution endpoints
4. 🔜 **Day 5**: Implement artifact endpoints (JUnit XML, HTML)

## 💬 Feedback

If you encounter any issues:
1. Check backend logs in terminal window #2
2. Check browser console for frontend errors
3. Review the testing guide: `docs/WEBHOOK_TESTING_GUIDE.md`
4. Check API docs: `http://localhost:8000/docs`

---

**Ready to test!** 🚀 Start with `start-dev.bat` and open `http://localhost:3000`
