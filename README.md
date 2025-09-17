# 🦷 Dental AI System

Hey there! This is my Dental AI System - a pretty cool project I've been working on that combines AI with dental analysis. Think of it as having a smart assistant that can look at dental X-rays, chat with you about what it finds, and even listen to your voice commands.

## ✨ What This Thing Does

- 🦷 **Looks at Your Teeth**: Upload dental X-rays and get AI-powered analysis
- 🤖 **Chats Like ChatGPT**: Real-time streaming responses that feel natural
- 🎤 **Listens to You**: Speak your questions instead of typing (and it remembers what you said!)
- 💾 **Remembers Everything**: Your chat history is saved so you can pick up where you left off
- 📊 **Gives Detailed Reports**: Spots problems and suggests treatment plans
- 🔄 **Streams in Real-Time**: No more waiting for long responses - it types as it thinks

## 🏗️ How It's Built

So here's the deal - this system is made up of a few different parts that all work together:

- **Frontend** (Port 3001): The pretty interface you see - built with React
- **Backend** (Port 3000): The brain that handles all the data - Node.js doing the heavy lifting
- **AI Engine** (Port 5002): The smart part - Flask talking to Mistral 7B through Ollama
- **Database**: MongoDB keeping track of all your conversations
- **The Magic**: Ollama running Mistral 7B locally (no internet needed for the AI part!)

## 📁 Project Structure

```
DentalPlan/
├── Dental-Frontend/          # React frontend application
│   ├── src/
│   │   ├── pages/Llama Chat/ # Chat interface with STT
│   │   └── utils/            # Table parsing utilities
│   └── package.json
├── Dental-Backend/           # Node.js backend API
│   ├── models/               # Database models
│   └── package.json
├── Dental-Rag-Flask-main/    # Flask AI engine
│   ├── app.py               # Main Flask application
│   ├── claude_try.py        # LLM interaction logic
│   └── requirements.txt
└── stream/                   # Streaming implementation files
```

## 🚀 Getting Started

Alright, let's get this thing running! First, you'll need a few things installed on your computer:

### What You Need First

- **Node.js** (v16 or higher) - for the web stuff
- **Python** (v3.8 or higher) - for the AI magic
- **Ollama** - this runs the AI model locally
- **MongoDB** - keeps your chat history safe

### Setting Up Python Virtual Environment (Recommended!)

Before we start, let's create a clean Python environment so we don't mess up your system:

```bash
# Create a virtual environment (I like to call it 'dental-ai-env')
python -m venv dental-ai-env

# Activate it (this is important!)
# On Mac/Linux:
source dental-ai-env/bin/activate
# On Windows:
# dental-ai-env\Scripts\activate

# You should see (dental-ai-env) in your terminal prompt now
```

### Option 1: The Easy Way (Just Run One Command!)

If you're feeling lazy (like me most of the time), just run this:

```bash
# 1. Get the code
git clone https://github.com/YOUR_USERNAME/DentalPlan.git
cd DentalPlan

# 2. Make the setup script work
chmod +x setup.sh

# 3. Let it do all the work for you
./setup.sh
```

That's it! The script will install everything automatically. Go grab a coffee ☕

### Option 2: The Manual Way (For Control Freaks)

If you want to see what's happening under the hood:

```bash
# 1. Get the code
git clone https://github.com/YOUR_USERNAME/DentalPlan.git
cd DentalPlan

# 2. Create and activate virtual environment
python -m venv dental-ai-env
source dental-ai-env/bin/activate  # On Windows: dental-ai-env\Scripts\activate

# 3. Install the backend stuff
cd Dental-Backend
npm install
cd ..

# 4. Install the frontend stuff
cd Dental-Frontend
npm install
cd ..

# 5. Install the Python AI stuff (make sure virtual env is activated!)
cd Dental-Rag-Flask-main
pip install -r requirements.txt
cd ..

# 6. Get the AI models (this might take a while)
ollama pull mistral:latest
ollama pull nomic-embed-text:latest
```

## 🎯 Time to Fire It Up!

Okay, now comes the fun part - actually running this thing! You'll need to open 4 different terminal windows (I know, it sounds like a lot, but trust me, it's worth it).

### Open These 4 Terminals:

**Terminal 1 - The Backend Brain:**
```bash
cd Dental-Backend
npm start
```
This handles all the data and API calls.

**Terminal 2 - The Pretty Interface:**
```bash
cd Dental-Frontend
npm start
```
This is what you'll actually see and click on.

**Terminal 3 - The AI Magic:**
```bash
# Make sure to activate the virtual environment first!
source dental-ai-env/bin/activate  # On Windows: dental-ai-env\Scripts\activate
cd Dental-Rag-Flask-main
python app.py
```
This is where the AI does its thinking.

**Terminal 4 - The AI Model Server:**
```bash
ollama serve
```
This runs the actual AI model (Mistral 7B).

### Where to Go

Once everything is running, open your browser and go to:
- **The Main App**: http://localhost:3001 (this is what you want!)
- **Backend API**: http://localhost:3000 (for debugging)
- **Flask API**: http://localhost:5002 (for more debugging)

## 🔧 Dependencies

### Backend Dependencies (Dental-Backend/package.json)
```json
{
  "dependencies": {
    "express": "^4.18.2",
    "mongoose": "^7.5.0",
    "cors": "^2.8.5",
    "axios": "^1.5.0"
  }
}
```

### Frontend Dependencies (Dental-Frontend/package.json)
```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "reactstrap": "^9.2.0",
    "axios": "^1.5.0"
  }
}
```

### Python Dependencies (Dental-Rag-Flask-main/requirements.txt)
```
Flask==2.3.3
flask-cors==4.0.0
ollama==0.1.7
langchain==0.0.350
pydantic==2.4.2
python-dotenv==1.0.0
```

## 🎤 The Cool Speech Stuff

So here's what makes the voice input pretty awesome:

- **Keeps Listening**: You can pause, think, and keep talking - it remembers everything you said
- **Types as You Speak**: No weird markers or brackets, just clean text appearing
- **Never Gives Up**: If it stops listening, it automatically starts again
- **Looks Clean**: No messy interim text cluttering up your input

## 🤖 The AI Streaming Magic

And here's what makes the AI responses feel like you're chatting with a real person:

- **Types Like a Human**: Each word appears as the AI thinks of it (just like ChatGPT!)
- **Super Fast**: Uses Server-Sent Events so there's no lag
- **Sees Everything**: Reports all the dental issues it finds, not just some of them
- **Remembers You**: All your conversations are saved in the database

## 🛠️ Want to Tinker With It?

If you're the type who likes to mess around with code (like me!), here's where everything lives:

### Where to Make Changes

1. **Frontend Stuff**: Look in `Dental-Frontend/src/` - this is the pretty interface
2. **Backend Logic**: Check out `Dental-Backend/` - handles all the data
3. **AI Brain**: The magic happens in `Dental-Rag-Flask-main/`
4. **Streaming Code**: All the real-time stuff is in the `stream/` folder

### Testing if Everything Works

Want to make sure all the pieces are talking to each other? Try these:

```bash
# Check if the backend is alive
curl http://localhost:3000/health

# Check if the AI engine is running
curl http://localhost:5002/health

# Test the streaming (this is the cool part!)
curl -X POST http://localhost:3000/api/rag-chat-stream \
  -H "Content-Type: application/json" \
  -d '{"query": "test message"}'
```

## 🔒 Keeping Things Safe

Just a heads up on the security stuff:

- This repo is **PRIVATE** because we're dealing with medical data (gotta keep that stuff safe!)
- No passwords or sensitive info is stored in the code
- Use environment variables for any API keys you might add
- Patient data is handled securely (because, you know, HIPAA and all that)

## 📝 When Things Go Wrong (And They Will!)

Here are the problems I've run into and how to fix them:

### "Port Already in Use" Error
This happens when you try to start something that's already running:
```bash
# Kill whatever's using these ports
lsof -ti:3000 | xargs kill -9
lsof -ti:3001 | xargs kill -9
lsof -ti:5002 | xargs kill -9
```

### "Ollama Model Not Found" Error
The AI model didn't download properly:
```bash
ollama pull mistral:latest
```

### MongoDB Won't Connect
Make sure MongoDB is actually running on your computer, and check the connection settings in the backend.

### Dependencies Are Acting Up
Sometimes npm gets confused (it happens to the best of us):
```bash
# Clear the cache and start fresh
npm cache clean --force

# Nuclear option - delete everything and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Virtual Environment Issues
If you're having trouble with the Python virtual environment:

```bash
# Permission issues? Make sure the activate script is executable:
chmod +x dental-ai-env/bin/activate

# Can't activate? Try these different methods:
source dental-ai-env/bin/activate
# Or try the full path:
source ./dental-ai-env/bin/activate
# Or try running it directly:
./dental-ai-env/bin/activate

# Still not working? Delete and recreate:
rm -rf dental-ai-env
python -m venv dental-ai-env
chmod +x dental-ai-env/bin/activate
source dental-ai-env/bin/activate
```

### "Module Not Found" Errors
If Python can't find modules, make sure your virtual environment is activated:
```bash
# You should see (dental-ai-env) in your terminal prompt
# If not, activate it:
source dental-ai-env/bin/activate
```

## 🤝 Want to Help Out?

If you've got ideas to make this better (and I'm sure you do!), here's how to contribute:

1. Fork this repo (make your own copy)
2. Create a new branch for your awesome feature
3. Make your changes and test them (please!)
4. Send me a pull request

## 📄 License

This is a private project for medical data - so keep it safe and don't share patient info!

## 🆘 Need Help?

If you're stuck (and trust me, I've been there):

1. Check the troubleshooting section above
2. Look at the logs in each terminal window
3. Make sure all the dependencies are actually installed
4. Double-check that all 4 services are running on the right ports

---

**That's it! Go build something awesome! 🦷🤖✨**

*P.S. - If you make this better, let me know! I'd love to see what you come up with.*
