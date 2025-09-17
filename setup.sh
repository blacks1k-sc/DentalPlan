#!/bin/bash

echo "🦷 Setting up Dental AI System..."

# Check if Python virtual environment already exists
if [ ! -d "dental-ai-env" ]; then
    echo "🐍 Creating Python virtual environment..."
    python -m venv dental-ai-env
    echo "✅ Virtual environment created!"
else
    echo "🐍 Virtual environment already exists, skipping creation..."
fi

echo "🐍 Activating virtual environment..."
source dental-ai-env/bin/activate

echo "📦 Installing Backend dependencies..."
cd Dental-Backend
npm install
cd ..

echo "📦 Installing Frontend dependencies..."
cd Dental-Frontend
npm install
cd ..

echo "🐍 Installing Python dependencies..."
cd Dental-Rag-Flask-main
pip install -r requirements.txt
cd ..

echo "🤖 Setting up Ollama models..."
echo "📥 Downloading Mistral 7B model (this might take a while)..."
ollama pull mistral:latest

echo "📥 Downloading embedding model..."
ollama pull nomic-embed-text:latest

echo "✅ Setup complete! Here's how to run everything:"
echo ""
echo "1. Activate the virtual environment:"
echo "   source dental-ai-env/bin/activate"
echo ""
echo "2. Start the services:"
echo "   Backend: cd Dental-Backend && npm start"
echo "   Frontend: cd Dental-Frontend && npm start"
echo "   Flask: cd Dental-Rag-Flask-main && python app.py"
echo "   Ollama: ollama serve"
echo ""
echo "3. Open your browser to: http://localhost:3001"
echo ""
echo "🎉 Happy coding!"
