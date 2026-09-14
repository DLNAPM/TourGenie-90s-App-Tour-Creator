<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1dyAZphe887j7d1UcYeX700K4zyGWDjAt

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `API_KEY` or `GEMINI_API_KEY` in `.env.local` to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy on Render.com

1. Create a new Static Site or Web Service connected to this repository.
2. In the Render Dashboard under **Environment Variables**, add:
   - **Key**: `API_KEY`
   - **Value**: Your Google Gemini API Key
3. Deploy! Render will build and run the application automatically.
