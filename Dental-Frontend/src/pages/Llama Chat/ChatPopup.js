import React, { useState, useRef, useEffect } from 'react';
import { Button, Form, Input, Popover, PopoverBody } from 'reactstrap';
import sessionManager from "utils/sessionManager"
import axios from 'axios';
import { parsePipeDelimitedTable } from '../../utils/tableParser';
import ttsInstance from '../../utils/textToSpeech';
// Removed speechToText utility import - implementing real-time transcription directly

const DentalChatPopup = ({ isOpen, toggle, target }) => {
  // Get patient and visit IDs first
  const patientId = sessionManager.getItem('patientId');
  const visitId = sessionManager.getItem('visitId');
  
  // Add CSS animations for pulse and blink effects
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0% { transform: scale(1); opacity: 0.8; }
        50% { transform: scale(1.2); opacity: 0.4; }
        100% { transform: scale(1); opacity: 0.8; }
      }
      @keyframes blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);
  
  const [messages, setMessages] = useState(() => {
    // Initialize with any existing messages from sessionStorage
    const savedMessages = sessionStorage.getItem(`chatMessages_${patientId}_${visitId}`);
    return savedMessages ? JSON.parse(savedMessages) : [];
  });
  const botTextRef = useRef({}); // id -> current text
  
  // Chat management
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState('');
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState(() => {
    const saved = localStorage.getItem('chatPopupPosition');
    return saved ? JSON.parse(saved) : { x: 0, y: 0 };
  });
  const [size, setSize] = useState(() => {
    const saved = localStorage.getItem('chatPopupSize');
    return saved ? JSON.parse(saved) : { width: 600, height: 500 };
  });
  
  // Speech-to-text states
  const [isRecording, setIsRecording] = useState(false);
  const [transcribedText, setTranscribedText] = useState('');
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [audioContext, setAudioContext] = useState(null);
  const accumulatedTranscriptRef = useRef('');
  
  // Text-to-Speech states
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSpeakingText, setCurrentSpeakingText] = useState('');
  
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const chatWindowRef = useRef(null);
  const dragHandleRef = useRef(null);
  // Chat job management
  const apiUrl = process.env.REACT_APP_RAGAPIURL || 'http://localhost:3000';
  // Use non-streaming chat job endpoint
  const CHAT_JOB_URL = `${apiUrl}/start-chat-job`;
  const CHAT_STATUS_URL = `${apiUrl}/chat-job-status`;
  // New streaming endpoint
  const CHAT_STREAM_URL = `${apiUrl}/api/rag-chat-stream`;
  const clientId = sessionManager.getItem('clientId');

  // Check if timestamps should be shown
  const showTimestamps = clientId === "67161fcbadd1249d59085f9a";
  
  // State for showing/hiding raw console log data
  const [showRawData, setShowRawData] = useState(() => {
    const saved = localStorage.getItem('chatPopupShowRawData');
    return saved ? JSON.parse(saved) : false;
  });

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);

  // Streaming chat implementation
  const handleStreamingMessage = async () => {
    console.log('Stream button clicked!', { input: input.trim(), isLoading, isStreaming });
    if (!input.trim() || isLoading || isStreaming) {
      console.log('Stream button blocked:', { hasInput: !!input.trim(), isLoading, isStreaming });
      if (!input.trim()) {
        console.log('❌ Please type a message first before clicking Stream!');
      }
      return;
    }
    
    console.log('✅ Stream button proceeding with input:', input.trim());

    const queryText = input;
    setInput('');
    setIsLoading(true);
    setIsStreaming(true);

    // Get current JSON data for the patient/visit FIRST
    const jsonData = await getCurrentJsonData();
    
    const userMessage = {
      text: queryText,
      sender: 'user',
      timestamp: new Date(),
      isError: false,
      consoleLogData: null
    };

    // Add user message and placeholder bot message
    const botMessageId = `bot_${Date.now()}`;
    const botMessage = {
      id: botMessageId,
      text: '',
      sender: 'bot',
      timestamp: new Date(),
      isError: false,
      isStreaming: true,
      consoleLogData: {
        query: queryText,
        status: "Streaming...",
        note: "Real-time streaming from Mistral LLM",
        timestamp: new Date().toISOString()
      }
    };

    setMessages(prev => [...prev, userMessage, botMessage]);
    
    // Save user message to database
    saveChatMessage(userMessage);
    
    try {
      // Prepare request data for POST
      const requestData = {
        query: queryText,
        patient_id: patientId,
        token: sessionManager.getItem('token')
      };
      
      if (jsonData) {
        requestData.json = jsonData;
      }

      // Prepare request data for real streaming
      const streamRequestData = {
        query: queryText,
        patient_name: patientId || 'default_patient'
      };
      
      if (jsonData) {
        streamRequestData.json = jsonData;
      }

      console.log('Making POST request to real streaming endpoint:', CHAT_STREAM_URL);
      console.log('Request data:', { query: queryText, patient_name: streamRequestData.patient_name, hasJson: !!jsonData });

      // Use the real streaming endpoint
      const response = await fetch(CHAT_STREAM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionManager.getItem('token')}`
        },
        body: JSON.stringify(streamRequestData)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.log('✅ Real streaming started!');
      
      // Read the stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          console.log('Stream completed');
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataContent = line.slice(6).trim();
            
            // Try to parse as JSON first
            try {
              const data = JSON.parse(dataContent);
              
              if (data.type === 'chunk' && data.content) {
                fullResponse += data.content;
                
                // Update the bot message with real streaming content
                setMessages(prev => prev.map(msg => 
                  msg.id === botMessageId 
                    ? { ...msg, text: fullResponse }
                    : msg
                ));
              } else if (data.type === 'error') {
                throw new Error(data.content || 'Streaming error');
              } else if (data.type === 'context') {
                // Handle context messages
                console.log('Context loaded:', data.content);
              }
            } catch (parseError) {
              // Fall back to plain text if JSON parsing fails
              console.log('Plain text chunk received:', dataContent);
              fullResponse += dataContent;
              
              // Update the bot message with plain text content
              setMessages(prev => prev.map(msg => 
                msg.id === botMessageId 
                  ? { ...msg, text: fullResponse }
                  : msg
              ));
            }
          } else if (line.startsWith('event: done')) {
            console.log('Stream done event received');
            break;
          } else if (line.startsWith(': ping')) {
            // Handle heartbeat
            console.log('Heartbeat received');
          }
        }
      }
      
      console.log('Real streaming completed');
      setIsStreaming(false);
      setIsLoading(false);
      
      // Finalize the bot message
      setMessages(prev => prev.map(msg => 
        msg.id === botMessageId 
          ? { ...msg, isStreaming: false, text: fullResponse }
          : msg
      ));
      
      // Save bot message to database after streaming completes
      const finalBotMessage = {
        text: fullResponse,
        sender: 'bot',
        timestamp: new Date().toISOString(),
        isError: false
      };
      saveChatMessage(finalBotMessage);

    } catch (error) {
      console.error('Streaming error:', error);
      
      setMessages(prev => prev.map(msg => 
        msg.id === botMessageId 
          ? { 
              ...msg, 
              isStreaming: false, 
              isError: true,
              text: `Error: ${error.message}`
            }
          : msg
      ));
      
      setIsStreaming(false);
      setIsLoading(false);
    }
  };

  // Cleanup on unmount (no longer needed for EventSource)
  useEffect(() => {
    return () => {
      // Cleanup any ongoing streams if needed
      setIsStreaming(false);
      setIsLoading(false);
    };
  }, []);

  // Non-streaming chat implementation

  // Speech-to-text functions with real-time transcription
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Set up audio context for recording
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      const microphone = audioCtx.createMediaStreamSource(stream);
      
      microphone.connect(analyser);
      
      // Set up MediaRecorder for backup (not used for real-time)
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks = [];
      
      recorder.ondataavailable = (event) => {
        chunks.push(event.data);
      };
      
      // Start real-time speech recognition
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        
        recognition.continuous = true; // Enable continuous recognition
        recognition.interimResults = true; // Get interim results as user speaks
        recognition.lang = 'en-US';
        
        recognition.onresult = (event) => {
          let finalTranscript = '';
          let interimTranscript = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            } else {
              interimTranscript += transcript;
            }
          }
          
          // Accumulate text using the ref
          if (finalTranscript) {
            // Add final transcript to accumulated text
            accumulatedTranscriptRef.current += finalTranscript;
            setTranscribedText(accumulatedTranscriptRef.current);
            setInput(accumulatedTranscriptRef.current);
          } else if (interimTranscript) {
            // Show accumulated text + current interim results directly
            const displayText = accumulatedTranscriptRef.current + interimTranscript;
            setTranscribedText(displayText);
            setInput(displayText);
          }
        };
        
        recognition.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
        };
        
        recognition.onend = () => {
          console.log('Speech recognition ended');
          // Restart recognition if still recording to maintain continuous listening
          if (isRecording) {
            console.log('Restarting speech recognition for continuous listening');
            setTimeout(() => {
              try {
                recognition.start();
              } catch (error) {
                console.log('Recognition already started or error restarting:', error);
              }
            }, 100);
          }
        };
        
        // Start recognition
        recognition.start();
        
        // Store recognition instance for cleanup
        setMediaRecorder({ recognition, recorder });
      }
      
      // Start recording
      recorder.start();
      
      setAudioChunks(chunks);
      setAudioContext(audioCtx);
      setIsRecording(true);
      // Clear accumulated transcript for new recording session
      accumulatedTranscriptRef.current = '';
      setTranscribedText('');
      setInput('');
      
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Error accessing microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      // Stop both recognition and recording
      if (mediaRecorder.recognition) {
        mediaRecorder.recognition.stop();
      }
      if (mediaRecorder.recorder) {
        mediaRecorder.recorder.stop();
      }
      
      setIsRecording(false);
      
      // Set final accumulated text when stopping
      setTranscribedText(accumulatedTranscriptRef.current);
      setInput(accumulatedTranscriptRef.current);
      
      // Clean up audio context safely
      if (audioContext && audioContext.state !== 'closed') {
        try {
          audioContext.close();
        } catch (error) {
          console.log('AudioContext already closed or closing');
        }
        setAudioContext(null);
      }
    }
  };

  // Real-time transcription is now handled directly in startRecording

  // Text-to-Speech functions
  const initializeTTS = async () => {
    try {
      const success = await ttsInstance.initialize();
      if (success) {
        console.log('TTS initialized successfully');
      } else {
        console.log('TTS initialization failed, using fallback');
      }
    } catch (error) {
      console.error('Error initializing TTS:', error);
    }
  };

  const speakText = (text) => {
    if (!ttsInstance.isSupported()) {
      alert('Text-to-speech not supported in this browser');
      return;
    }

    try {
      // Stop any current speech before starting new one
      if (isSpeaking) {
        ttsInstance.stop();
        setIsSpeaking(false);
        setIsPaused(false);
      }
      
      ttsInstance.speak(text);
      setIsSpeaking(true);
      setIsPaused(false);
      setCurrentSpeakingText(text);
      
      // Update status periodically
      const statusInterval = setInterval(() => {
        const status = ttsInstance.getStatus();
        setIsSpeaking(status.isPlaying);
        setIsPaused(status.isPaused);
        
        if (!status.isPlaying && !status.isPaused) {
          clearInterval(statusInterval);
          setCurrentSpeakingText('');
        }
      }, 100);
      
    } catch (error) {
      console.error('Error speaking text:', error);
      alert('Error starting text-to-speech');
    }
  };



  const pauseSpeech = () => {
    ttsInstance.pause();
    setIsPaused(true);
  };

  const resumeSpeech = () => {
    ttsInstance.resume();
    setIsPaused(false);
  };

  const stopSpeech = () => {
    ttsInstance.stop();
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentSpeakingText('');
  };

  // Initialize TTS when component mounts
  useEffect(() => {
    initializeTTS();
  }, []);

  // Save position and size to localStorage
  useEffect(() => {
    localStorage.setItem('chatPopupPosition', JSON.stringify(position));
  }, [position]);

  // Cleanup audio resources when component unmounts
  useEffect(() => {
    return () => {
      if (mediaRecorder && isRecording) {
        try {
          if (mediaRecorder.recognition) {
            mediaRecorder.recognition.stop();
          }
          if (mediaRecorder.recorder) {
            mediaRecorder.recorder.stop();
          }
        } catch (error) {
          console.log('MediaRecorder already stopped');
        }
      }
      if (audioContext && audioContext.state !== 'closed') {
        try {
          audioContext.close();
        } catch (error) {
          console.log('AudioContext already closed or closing');
        }
      }
      
      // Cleanup TTS
      if (ttsInstance) {
        ttsInstance.stop();
      }
      
      // Cleanup any ongoing requests
    };
  }, [mediaRecorder, isRecording, audioContext]);

  useEffect(() => {
    localStorage.setItem('chatPopupSize', JSON.stringify(size));
  }, [size]);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (isOpen) {
      // Use requestAnimationFrame for smoother scrolling
      requestAnimationFrame(() => {
        setTimeout(scrollToBottom, 0);
      });
    }
  }, [messages, isOpen]);

  // Load chat history and upload X-ray annotations when popup opens
  useEffect(() => {
    const currentPatientId = sessionManager.getItem('patientId');
    const currentVisitId = sessionManager.getItem('visitId');
    
    console.log('🔄 ChatPopup useEffect triggered:', { 
      isOpen, 
      patientId: currentPatientId, 
      visitId: currentVisitId, 
      originalPatientId: patientId,
      originalVisitId: visitId,
      currentMessageCount: messages.length 
    });
    
    if (isOpen && currentPatientId && currentVisitId) {
      // Load chat history if we don't have messages
      if (messages.length === 0) {
        console.log('📥 Loading chat history because messages.length = 0');
        loadChatHistory();
      } else {
        console.log('⏭️ Skipping chat history load because messages.length =', messages.length);
      }
      
      // Always upload X-ray annotations to ensure RAG context is available
      uploadXrayAnnotations().then(success => {
        if (success) {
          console.log('✅ RAG context established - X-ray annotations uploaded successfully');
        } else {
          console.log('⚠️ RAG context not established - no annotations to upload or upload failed');
        }
      }).catch(error => {
        console.error('❌ Failed to establish RAG context:', error);
      });
    } else {
      console.log('❌ ChatPopup useEffect: Missing required data:', {
        isOpen,
        currentPatientId,
        currentVisitId
      });
    }
  }, [isOpen, patientId, visitId]);

  // Save messages to sessionStorage whenever they change (debounced to prevent blocking)
  useEffect(() => {
    console.log('🔄 Messages state changed:', messages.length, 'messages');
    if (patientId && visitId && messages.length > 0) {
      // Use setTimeout to make this non-blocking
      const timeoutId = setTimeout(() => {
        try {
          sessionStorage.setItem(`chatMessages_${patientId}_${visitId}`, JSON.stringify(messages));
        } catch (error) {
          console.warn('Failed to save messages to sessionStorage:', error);
        }
      }, 100); // 100ms debounce
      
      return () => clearTimeout(timeoutId);
    }
  }, [messages, patientId, visitId]);

  // Drag and resize functionality
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isDragging && chatWindowRef.current) {
        const newX = e.clientX - dragOffset.x;
        const newY = e.clientY - dragOffset.y;

        // Constrain to viewport
        const maxX = window.innerWidth - size.width;
        const maxY = window.innerHeight - size.height;

        setPosition({
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY))
        });
      }

      if (isResizing && chatWindowRef.current) {
        const rect = chatWindowRef.current.getBoundingClientRect();
        let newWidth = size.width;
        let newHeight = size.height;
        let newX = position.x;
        let newY = position.y;

        if (resizeHandle.includes('right')) {
          newWidth = Math.max(300, e.clientX - rect.left);
        }
        if (resizeHandle.includes('left')) {
          const deltaX = e.clientX - rect.left;
          newWidth = Math.max(300, size.width - deltaX);
          newX = Math.min(position.x + deltaX, position.x + size.width - 300);
        }
        if (resizeHandle.includes('bottom')) {
          newHeight = Math.max(250, e.clientY - rect.top);
        }
        if (resizeHandle.includes('top')) {
          const deltaY = e.clientY - rect.top;
          newHeight = Math.max(250, size.height - deltaY);
          newY = Math.min(position.y + deltaY, position.y + size.height - 250);
        }

        // Constrain to viewport
        if (newX + newWidth > window.innerWidth) {
          newWidth = window.innerWidth - newX;
        }
        if (newY + newHeight > window.innerHeight) {
          newHeight = window.innerHeight - newY;
        }

        setSize({ width: newWidth, height: newHeight });
        if (resizeHandle.includes('left') || resizeHandle.includes('top')) {
          setPosition({ x: newX, y: newY });
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setResizeHandle('');
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, dragOffset, resizeHandle, size, position]);

  const handleMouseDown = (e) => {
    if (dragHandleRef.current && dragHandleRef.current.contains(e.target)) {
      const rect = chatWindowRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
      setIsDragging(true);
    }
  };

  const handleResizeMouseDown = (e, handle) => {
    e.stopPropagation();
    setIsResizing(true);
    setResizeHandle(handle);
  };

  const loadChatHistory = async () => {
    // Get fresh values from sessionManager
    const currentPatientId = sessionManager.getItem('patientId');
    const currentVisitId = sessionManager.getItem('visitId');
    
    console.log('🔍 DEBUG: loadChatHistory called with:', {
      patientId: currentPatientId,
      visitId: currentVisitId,
      originalPatientId: patientId,
      originalVisitId: visitId
    });
    
    if (!currentPatientId || !currentVisitId) {
      console.log('❌ Cannot load chat history: patientId =', currentPatientId, 'visitId =', currentVisitId);
      return;
    }

    console.log('📥 Loading chat history from database for patient:', currentPatientId, 'visit:', currentVisitId);
    setIsLoadingHistory(true);
    
    try {
      // First try to load from database
      const token = sessionManager.getItem('token');
      const response = await axios.get('http://localhost:3000/get-chat-history', {
        params: { patientId: currentPatientId, visitId: currentVisitId },
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success && response.data.messages.length > 0) {
        // Convert database format to frontend format
        const dbMessages = response.data.messages.map(msg => ({
          id: Date.now() + Math.random(), // Generate unique ID
          text: msg.text,
          sender: msg.sender,
          timestamp: msg.timestamp,
          isError: msg.isError || false
        }));
        
        console.log('Chat history loaded from database:', dbMessages.length, 'messages');
        setMessages(dbMessages);
        
        // Also save to sessionStorage for offline access
        sessionStorage.setItem(`chatMessages_${currentPatientId}_${currentVisitId}`, JSON.stringify(dbMessages));
      } else {
        // Fallback to sessionStorage if no database history
        const savedMessages = sessionStorage.getItem(`chatMessages_${currentPatientId}_${currentVisitId}`);
        if (savedMessages) {
          const parsedMessages = JSON.parse(savedMessages);
          console.log('Chat history loaded from sessionStorage fallback:', parsedMessages.length, 'messages');
          setMessages(parsedMessages);
        } else {
          console.log('No chat history found in database or sessionStorage');
          setMessages([]);
        }
      }
    } catch (error) {
      console.error('Error loading chat history from database:', error);
      
      // Fallback to sessionStorage on error
      try {
        const savedMessages = sessionStorage.getItem(`chatMessages_${currentPatientId}_${currentVisitId}`);
        if (savedMessages) {
          const parsedMessages = JSON.parse(savedMessages);
          console.log('Chat history loaded from sessionStorage fallback:', parsedMessages.length, 'messages');
          setMessages(parsedMessages);
        } else {
          setMessages([]);
        }
      } catch (fallbackError) {
        console.error('Error loading chat history from sessionStorage fallback:', fallbackError);
        setMessages([]);
      }
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const saveChatMessage = async (message) => {
    // Get fresh values from sessionManager
    const currentPatientId = sessionManager.getItem('patientId');
    const currentVisitId = sessionManager.getItem('visitId');
    
    console.log('💾 DEBUG: saveChatMessage called with:', {
      message: message,
      patientId: currentPatientId,
      visitId: currentVisitId,
      originalPatientId: patientId,
      originalVisitId: visitId
    });
    
    if (!currentPatientId || !currentVisitId) {
      console.log('❌ Cannot save chat message: patientId =', currentPatientId, 'visitId =', currentVisitId);
      return;
    }

    try {
      // Save to database
      const token = sessionManager.getItem('token');
      const response = await axios.post('http://localhost:3000/save-chat-message', {
        patientId: currentPatientId,
        visitId: currentVisitId,
        message: {
          text: message.text,
          sender: message.sender,
          isError: message.isError || false
        }
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      console.log('✅ Chat message saved to database for patient:', currentPatientId, 'visit:', currentVisitId, 'response:', response.data);
    } catch (error) {
      console.error('Error saving chat message to database:', error);
      // Continue anyway - sessionStorage will still work as fallback
    }
    
    // Messages are also automatically saved to sessionStorage via the useEffect hook
  };

  // RAG functions are now handled by the Node.js backend which forwards to Flask
  
  // Function to upload X-ray annotations to Flask for RAG processing
  const uploadXrayAnnotations = async () => {
    if (!patientId || !visitId) {
      console.log('Cannot upload X-ray annotations: patientId =', patientId, 'visitId =', visitId);
      return false;
    }

    try {
      // Fetch the current visit's annotations from the Node.js backend
      const response = await fetch(`${apiUrl}/visitid-annotations?visitID=${visitId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionManager.getItem("token")}`
        },
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Fetched annotations for RAG upload:', data);

      if (data.images && data.images.length > 0) {
        // Combine all annotations from all images
        const allAnnotations = [];
        data.images.forEach(image => {
          if (image.annotations && image.annotations.annotations && image.annotations.annotations.annotations) {
            allAnnotations.push(...image.annotations.annotations.annotations);
          }
        });

        if (allAnnotations.length > 0) {
          // Debug: Log the annotation data being sent
          console.log('Uploading annotation data:', {
            patientId,
            visitId,
            annotationData: {
              images: data.images,
              totalAnnotations: allAnnotations.length,
              annotations: allAnnotations
            }
          });
          
          // Upload annotations to Flask for RAG processing
          const uploadResponse = await fetch(`${apiUrl}/api/xray-upload`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${sessionManager.getItem("token")}`
            },
            credentials: 'include',
            body: JSON.stringify({
              patientId,
              visitId,
              annotationData: {
                images: data.images,
                totalAnnotations: allAnnotations.length,
                annotations: allAnnotations
              }
            })
          });

          if (!uploadResponse.ok) {
            throw new Error(`Upload HTTP error! status: ${uploadResponse.status}`);
          }

          const uploadResult = await uploadResponse.json();
          console.log('X-ray annotations uploaded to RAG system:', uploadResult);
          
          if (uploadResult.status === 'success') {
            console.log(`✅ X-ray annotations processed successfully. Found ${uploadResult.annotationsFound} annotations.`);
            return true;
          } else {
            console.warn(`⚠️ X-ray upload partial success: ${uploadResult.message}`);
            return false;
          }
        } else {
          console.log('No annotations found to upload');
          return false;
        }
      } else {
        console.log('No images found for this visit');
        return false;
      }
    } catch (error) {
      console.error('Error uploading X-ray annotations:', error);
      return false;
    }
  };

  // Function to get current JSON data for the patient/visit
  const getCurrentJsonData = async () => {
    if (!patientId || !visitId) {
      console.log('Cannot get JSON data: patientId =', patientId, 'visitId =', visitId);
      return null;
    }

    try {
      // Fetch the current visit's annotations from the Node.js backend
      const response = await fetch(`${apiUrl}/visitid-annotations?visitID=${visitId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionManager.getItem("token")}`
        },
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Fetched annotations for chat:', data);

      if (data.images && data.images.length > 0) {
        // Combine all annotations from all images
        const allAnnotations = [];
        data.images.forEach(image => {
          if (image.annotations && image.annotations.annotations && image.annotations.annotations.annotations) {
            allAnnotations.push(...image.annotations.annotations.annotations);
          }
        });

        if (allAnnotations.length > 0) {
          return {
            images: data.images,
            totalAnnotations: allAnnotations.length,
            annotations: allAnnotations
          };
        } else {
          console.log('No annotations found');
          return null;
        }
      } else {
        console.log('No images found for this visit');
        return null;
      }
    } catch (error) {
      console.error('Error getting JSON data:', error);
      return null;
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const queryText = input;
    setInput('');
    setIsLoading(true);

    // Get current JSON data for the patient/visit FIRST
    const jsonData = await getCurrentJsonData();
    
    // Create the raw data payload that will be sent to LLM
    const rawDataPayload = {
      query: queryText,
      json: jsonData,
      patient_id: patientId
    };

    const userMessage = {
      text: input,
      sender: 'user',
      timestamp: new Date(),
      isError: false,
      // No consoleLogData for user messages - raw CV data is available in backend folder
      consoleLogData: null
    };

    // Add user message and placeholder bot message
    const botMessageId = `bot_${Date.now()}`;
    const botMessage = {
      id: botMessageId,
      text: 'Processing your request...',
      sender: 'bot',
      timestamp: new Date(),
      isError: false,
      isStreaming: false,
      // Show placeholder until job completes with transformed data
      consoleLogData: {
        query: queryText,
        status: "Processing...",
        note: "Transformed LLM data will appear here when processing completes",
        timestamp: new Date().toISOString()
      }
    };

    setMessages(prev => [...prev, userMessage, botMessage]);
    
    // Save user message to database
    saveChatMessage(userMessage);
    
    try {
      
      // Start chat job
      const jobResponse = await fetch(CHAT_JOB_URL, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionManager.getItem('token')}`
        },
        body: JSON.stringify(rawDataPayload)
      });

      if (!jobResponse.ok) {
        throw new Error(`Failed to start chat job: ${jobResponse.statusText}`);
      }

      const { jobId } = await jobResponse.json();
      
      // Poll for job completion
      const pollForResult = async () => {
        try {
          const statusResponse = await fetch(`${CHAT_STATUS_URL}/${jobId}`, {
            headers: {
              'Authorization': `Bearer ${sessionManager.getItem('token')}`
            }
          });

          if (!statusResponse.ok) {
            throw new Error(`Failed to get job status: ${statusResponse.statusText}`);
          }

          const jobStatus = await statusResponse.json();
          
          if (jobStatus.status === 'completed') {
            console.log('Job completed, result:', jobStatus.result);
            console.log('Debug data available:', !!jobStatus.result.debug_data);
            
            // Update bot message with the result and transformed data
            const finalResponse = jobStatus.result.answer || jobStatus.result.message || 'Response received';
            setMessages(prev => prev.map(msg => 
              msg.id === botMessageId 
                ? { 
                    ...msg, 
                    text: finalResponse, 
                    isStreaming: false,
                    // Update consoleLogData with only the transformed LLM data (no raw CV data)
                    consoleLogData: jobStatus.result.debug_data ? {
                      query: queryText,
                      transformed_llm_data: jobStatus.result.debug_data.transformed_llm_data,
                      request_payload: jobStatus.result.debug_data.request_payload,
                      patient_id: patientId,
                      timestamp: new Date().toISOString(),
                      note: "Transformed LLM data - actual data sent to AI"
                    } : {
                      query: queryText,
                      status: "Completed but no debug data",
                      note: "Job completed but debug data not available",
                      timestamp: new Date().toISOString()
                    }
                  }
                : msg
            ));
            
            // Save bot message to database after completion
            const finalBotMessage = {
              text: finalResponse,
              sender: 'bot',
              timestamp: new Date().toISOString(),
              isError: false
            };
            saveChatMessage(finalBotMessage);
            setIsLoading(false);
            setConnectionStatus('connected');
          } else if (jobStatus.status === 'failed') {
            throw new Error(jobStatus.error || 'Job failed');
          } else if (jobStatus.status === 'pending') {
            // Continue polling
            setTimeout(pollForResult, 1000);
          }
        } catch (error) {
          console.error('Error polling job status:', error);
          setMessages(prev => prev.map(msg => 
            msg.id === botMessageId 
              ? { ...msg, text: `Error: ${error.message}`, isError: true, isStreaming: false }
              : msg
          ));
          setConnectionStatus('error');
          setIsLoading(false);
        }
      };

      // Start polling
      pollForResult();

    } catch (error) {
      console.error('Error in chat request:', error);
      setMessages(prev => prev.map(msg => 
        msg.id === botMessageId 
          ? { ...msg, text: `Error: ${error.message}`, isError: true, isStreaming: false }
          : msg
      ));
      setConnectionStatus('error');
      setIsLoading(false);
    }
  };

  const clearChatHistory = async () => {
    if (!patientId || !visitId) return;

    try {
      // Show loading state
      setIsLoading(true);
      
      // Clear messages from database
      const token = sessionManager.getItem('token');
      await axios.post('http://localhost:3000/clear-chat-history', {
        patientId,
        visitId
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Clear messages from state
      setMessages([]);
      
      // Clear messages from sessionStorage
      sessionStorage.removeItem(`chatMessages_${patientId}_${visitId}`);
      
      console.log('Chat history cleared successfully from database and sessionStorage for this visit');
      
    } catch (error) {
      console.error('Error clearing chat history from database:', error);
      
      // Still clear from state and sessionStorage even if database clear fails
      setMessages([]);
      sessionStorage.removeItem(`chatMessages_${patientId}_${visitId}`);
      console.log('Chat history cleared from sessionStorage as fallback');
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      month: 'short',
      day: 'numeric'
    });
  };

  if (!isOpen) return null;

  // Check if both patientId and visitId are available
  if (!patientId || !visitId) {
    return (
      <div
        ref={chatWindowRef}
        className="dental-chat-window"
        style={{
          position: 'fixed',
          top: position.y,
          left: position.x,
          width: size.width,
          height: size.height,
          zIndex: 9999,
          minWidth: '300px',
          minHeight: '250px'
        }}
      >
        <div className="bg-white rounded-lg shadow-xl border p-4">
          <div className="text-center text-gray-600">
            {!patientId ? 'Please select a patient first.' : 'Please select a visit first.'}
            <br />
            <small>Debug: patientId = {patientId}, visitId = {visitId}</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={chatWindowRef}
      className="dental-chat-window"
      style={{
        position: 'fixed',
        top: position.y,
        left: position.x,
        width: size.width,
        height: size.height,
        zIndex: 9999,
        cursor: isDragging ? 'grabbing' : 'default',
        minWidth: '300px',
        minHeight: '250px'
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        className="bg-white rounded-lg shadow-xl border"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative'
        }}
      >
        {/* Resize handles */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '10px',
            height: '10px',
            cursor: 'ne-resize',
            zIndex: 10
          }}
          onMouseDown={(e) => handleResizeMouseDown(e, 'top-right')}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '10px',
            height: '10px',
            cursor: 'nw-resize',
            zIndex: 10
          }}
          onMouseDown={(e) => handleResizeMouseDown(e, 'top-left')}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: '10px',
            height: '10px',
            cursor: 'se-resize',
            zIndex: 10
          }}
          onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-right')}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '10px',
            height: '10px',
            cursor: 'sw-resize',
            zIndex: 10
          }}
          onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-left')}
        />
        <div
          style={{
            position: 'absolute',
            top: '10px',
            right: 0,
            width: '5px',
            height: 'calc(100% - 20px)',
            cursor: 'e-resize',
            zIndex: 10
          }}
          onMouseDown={(e) => handleResizeMouseDown(e, 'right')}
        />
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: 0,
            width: '5px',
            height: 'calc(100% - 20px)',
            cursor: 'w-resize',
            zIndex: 10
          }}
          onMouseDown={(e) => handleResizeMouseDown(e, 'left')}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '10px',
            width: 'calc(100% - 20px)',
            height: '5px',
            cursor: 'n-resize',
            zIndex: 10
          }}
          onMouseDown={(e) => handleResizeMouseDown(e, 'top')}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: '10px',
            width: 'calc(100% - 20px)',
            height: '5px',
            cursor: 's-resize',
            zIndex: 10
          }}
          onMouseDown={(e) => handleResizeMouseDown(e, 'bottom')}
        />

        {/* Header - Draggable area */}
        <div
          ref={dragHandleRef}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #000',
            backgroundColor: '#f9fafb',
            width: '100%',
            padding: '8px 12px',
            cursor: 'grab',
            borderTopLeftRadius: '8px',
            borderTopRightRadius: '8px',
            flexWrap: 'nowrap',
            minWidth: 0,
            flexShrink: 0
          }}
        >
          <h5
            className="m-0 font-semibold flex items-center gap-2"
            style={{
              color: '#333',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexShrink: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            <i className="fas fa-grip-vertical" style={{ flexShrink: 0 }}></i>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Oral Wisdom AI
            </span>
          </h5>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <Button
              onClick={clearChatHistory}
              className="border-0 px-2 py-1 text-xs"
              title="Clear chat history"
              disabled={isLoading || messages.length === 0}
              style={{
                whiteSpace: 'nowrap',
                flexShrink: 0,
                opacity: (isLoading || messages.length === 0) ? 0.6 : 1,
                backgroundColor: '#dc3545',
                color: 'white'
              }}
            >
              {isLoading ? 'Clearing...' : 'Clear'}
            </Button>
            <Button
              onClick={() => {
                console.log('Current session data:', {
                  patientId: sessionManager.getItem('patientId'),
                  visitId: sessionManager.getItem('visitId'),
                  token: sessionManager.getItem("token") ? 'Present' : 'Missing'
                });
              }}
              className="border-0 px-2 py-1 text-xs"
              title="Debug session data"
              style={{
                whiteSpace: 'nowrap',
                flexShrink: 0,
                backgroundColor: '#6c757d',
                color: 'white'
              }}
            >
              Debug
            </Button>
            <Button
              onClick={() => {
                const newState = !showRawData;
                setShowRawData(newState);
                localStorage.setItem('chatPopupShowRawData', JSON.stringify(newState));
              }}
              className="border-0 px-2 py-1 text-xs"
              title={showRawData ? "Hide raw console data" : "Show raw console data"}
              style={{
                whiteSpace: 'nowrap',
                flexShrink: 0,
                backgroundColor: showRawData ? '#28a745' : '#17a2b8',
                color: 'white'
              }}
            >
              {showRawData ? 'Hide Raw' : 'Show Raw'}
            </Button>
            <Button
              onClick={toggle}
              className="text-black hover:text-black bg-primary border-0"
              aria-label="Close"
              style={{
                width: '30px',
                height: '30px',
                padding: 0,
                lineHeight: '30px',
                fontSize: '18px',
                flexShrink: 0,
              }}
            >
              ×
            </Button>
          </div>
        </div>

        {/* Messages Container - This is the scrollable area */}
        <div
          ref={messagesContainerRef}
          style={{
            flex: '1 1 auto',
            overflowY: 'auto',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {isLoadingHistory ? (
            <div className="text-center text-black mt-3" style={{ fontSize: '16px' }}>
              Loading chat history...
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center text-black mt-3 mb-auto" style={{ fontSize: '20px' }}>
              Ask me anything about dental terms and procedures!
            </div>
          ) : (
            <>
              {/* Debug: Show current messages state */}
              {console.log('🎬 RENDERING MESSAGES:', messages.length, 'messages')}
              {messages.map((msg, index) => {
                console.log(`🎭 RENDERING MESSAGE ${index}:`, msg.sender, 'Text length:', msg.text?.length || 0, 'ID:', msg.id);
                return (
                <div
                  key={msg.id || `msg_${index}`}
                  className={`mb-3 rounded-lg ${msg.sender !== 'bot' ? 'text-right' : 'text-left'}`}
                  style={{ fontSize: '12px', opacity: 0.9 }}
                >
                  <div
                    className="inline-block px-3 py-2 rounded-lg"
                    style={{
                      maxWidth: '85%',
                      wordBreak: 'break-word',
                      backgroundColor: msg.sender !== 'bot'
                        ? '#fef7f7' // Light pink for user messages
                        : msg.isError
                          ? '#fef2f2' // Very light red for errors
                          : '#f3f4f6', // Light gray for bot messages
                      color: msg.sender !== 'bot'
                        ? '#be123c' // Darker pink text for user
                        : msg.isError
                          ? '#dc2626' // Red text for errors
                          : '#374151', // Dark gray text for bot
                      border: msg.sender !== 'bot'
                        ? '1px solid #f9a8d4' // Subtle pink border for user
                        : msg.isError
                          ? '1px solid #fca5a5' // Light red border for errors
                          : '1px solid #e5e7eb' // Light gray border for bot
                    }}
                  >
                    <div>
                      {msg.sender !== 'bot' ? (
                        <div>
                          <div style={{ marginBottom: '8px' }}>
                            {`${msg.sender}: ${msg.text}`}
                          </div>
                          
                          {/* No raw data display for user messages - raw CV data available in backend folder */}
                        </div>
                      ) : (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <span>Oral Wisdom AI:</span>
                          </div>
                          
                          {/* Show transformed LLM data if toggle is on and data exists */}
                          {showRawData && msg.consoleLogData && (
                            <div style={{
                              backgroundColor: '#fff5f5',
                              border: '1px solid #fecaca',
                              borderRadius: '4px',
                              padding: '8px',
                              marginBottom: '8px',
                              fontSize: '12px',
                              fontFamily: 'monospace',
                              maxHeight: '200px',
                              overflow: 'auto'
                            }}>
                              <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#dc2626' }}>
                                Transformed LLM Data:
                              </div>
                              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#dc2626' }}>
                                {JSON.stringify(msg.consoleLogData, null, 2)}
                              </pre>
                            </div>
                          )}
                          
                          <div 
                            data-message-content
                            dangerouslySetInnerHTML={{ 
                              __html: (() => {
                                console.log(`🎨 RENDERING BOT TEXT (${msg.id}):`, msg.text?.length || 0, 'chars:', msg.text?.substring(0, 50) + '...');
                                
                                // Filter out console log data if toggle is off
                                let filteredText = msg.text || '';
                                if (!showRawData) {
                                  const originalLength = filteredText.length;
                                  
                                  // Remove JSON console log blocks from the message text
                                  // Pattern 1: Complete console_log JSON objects
                                  filteredText = filteredText.replace(/\{[^}]*"type":\s*"console_log"[^}]*\}[^}]*\}/g, '');
                                  
                                  // Pattern 2: Any remaining console_log references
                                  filteredText = filteredText.replace(/\{[^}]*"console_log"[^}]*\}/g, '');
                                  
                                  // Pattern 3: Remove standalone JSON objects that might be console logs
                                  filteredText = filteredText.replace(/\{[^}]*"message":\s*"[^"]*loaded into chatbot"[^}]*\}/g, '');
                                  
                                  // Pattern 4: Remove any remaining JSON artifacts
                                  filteredText = filteredText.replace(/\{[^}]*"total_annotations"[^}]*\}/g, '');
                                  filteredText = filteredText.replace(/\{[^}]*"total_anomalies"[^}]*\}/g, '');
                                  
                                  // Clean up any extra whitespace or newlines left behind
                                  filteredText = filteredText.replace(/\n\s*\n/g, '\n').trim();
                                  
                                  // Debug logging
                                  if (originalLength !== filteredText.length) {
                                    console.log(`🔧 FILTERED CONSOLE LOG DATA: Removed ${originalLength - filteredText.length} characters from message text`);
                                  }
                                }
                                
                                return parsePipeDelimitedTable(filteredText);
                              })()
                            }} 
                          />
                          
                          {/* Streaming indicator */}
                          {msg.isStreaming && (
                            <span 
                              className="inline-block w-2 h-4 ml-1 bg-gray-400 animate-pulse"
                              style={{
                                width: '2px',
                                height: '16px',
                                backgroundColor: '#9ca3af',
                                animation: 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                              }}
                            ></span>
                          )}
                        </div>
                      )}
                    </div>
                    {showTimestamps && msg.timestamp && (
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: '8px',
                        padding: '0 4px'
                      }}>
                        {/* Timestamp */}
                        <div style={{
                          fontSize: '10px',
                          opacity: 0.6,
                          fontStyle: 'italic'
                        }}>
                          {formatTimestamp(msg.timestamp)}
                        </div>
                        
                        {/* TTS Controls - Simple ChatGPT-style icons */}
                        {msg.sender === 'bot' && (
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                          }}>
                            {/* Speaker Button */}
                            <Button
                              type="button"
                              onClick={() => {
                                if (isSpeaking && currentSpeakingText === msg.text) {
                                  stopSpeech();
                                } else {
                                  speakText(msg.text);
                                }
                              }}
                              disabled={isLoading || isLoadingHistory}
                              style={{
                                backgroundColor: 'transparent',
                                border: 'none',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: (isLoading || isLoadingHistory) ? 'not-allowed' : 'pointer',
                                borderRadius: '4px',
                                minWidth: '24px',
                                height: '24px'
                              }}
                              title={(isSpeaking && currentSpeakingText === msg.text) ? 'Stop Speaking' : 'Speak this response'}
                              onMouseEnter={(e) => e.target.style.backgroundColor = '#f0f0f0'}
                              onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                              <i 
                                className={(isSpeaking && currentSpeakingText === msg.text) ? 'ion ion-md-close' : 'ion ion-md-volume-high'} 
                                style={{ 
                                  color: (isSpeaking && currentSpeakingText === msg.text) ? '#dc3545' : '#6c757d', 
                                  fontSize: '16px' 
                                }} 
                              />
                            </Button>

                            {/* Pause/Resume Button - only show when speaking this message */}
                            {isSpeaking && currentSpeakingText === msg.text && (
                              <Button
                                type="button"
                                onClick={isPaused ? resumeSpeech : pauseSpeech}
                                style={{
                                  backgroundColor: 'transparent',
                                  border: 'none',
                                  padding: '4px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  borderRadius: '4px',
                                  minWidth: '24px',
                                  height: '24px'
                                }}
                                title={isPaused ? 'Resume Speaking' : 'Pause Speaking'}
                                onMouseEnter={(e) => e.target.style.backgroundColor = '#f0f0f0'}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                              >
                                <i 
                                  className={isPaused ? 'ion ion-md-play' : 'ion ion-md-pause'} 
                                  style={{ 
                                    color: isPaused ? '#28a745' : '#6c757d', 
                                    fontSize: '16px' 
                                  }} 
                                />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
              {isLoading && (
                <div className="text-left mb-3" style={{ opacity: 0.7 }}>
                  <div className="inline-block px-3 py-2 rounded-lg bg-gray-100">
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Form */}
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="border-t"
          style={{
            padding: '12px',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', width: '100%', gap: '8px', alignItems: 'center' }}>
            <Input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a dental question..."
              disabled={isLoading || isLoadingHistory}
              style={{
                flex: '1',
                border: '1px solid #ccc',
                borderRadius: '4px',
                padding: '8px 12px',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              onFocus={(e) => e.target.style.borderColor = '#007bff'}
              onBlur={(e) => e.target.style.borderColor = '#ccc'}
            />
            
            {/* Microphone Button */}
            <Button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isLoading || isLoadingHistory}
              style={{
                backgroundColor: isRecording ? '#dc3545' : '#6c757d',
                border: 'none',
                borderRadius: '50%',
                width: '40px',
                height: '40px',
                padding: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: (isLoading || isLoadingHistory) ? 'not-allowed' : 'pointer',
                flexShrink: 0,
                position: 'relative'
              }}
              title={isRecording ? 'Stop Recording' : 'Start Voice Input'}
            >
              {isRecording ? (
                <i className="ion ion-md-square" style={{ color: 'white', fontSize: '16px' }}></i>
              ) : (
                <i className="ion ion-md-mic" style={{ color: 'white', fontSize: '16px' }}></i>
              )}
              
              {/* Voice Level Indicator */}
              {isRecording && (
                <div
                  style={{
                    position: 'absolute',
                    top: '-8px',
                    right: '-8px',
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    backgroundColor: '#dc3545',
                    animation: 'pulse 1s infinite',
                    opacity: 0.8
                  }}
                />
              )}
            </Button>




            
            <Button
              type="submit"
              disabled={isLoading || isLoadingHistory || isStreaming}
              style={{
                backgroundColor: 'var(--bs-primary, #007bff)',
                border: 'none',
                borderRadius: '4px',
                padding: '8px 16px',
                color: 'white',
                fontSize: '14px',
                cursor: (isLoading || isLoadingHistory || isStreaming) ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                marginRight: '8px'
              }}
            >
              Send
            </Button>
            
            <Button
              type="button"
              onClick={handleStreamingMessage}
              disabled={isLoading || isLoadingHistory || isStreaming}
              style={{
                backgroundColor: isStreaming ? '#28a745' : '#6c757d',
                border: 'none',
                borderRadius: '4px',
                padding: '8px 16px',
                color: 'white',
                fontSize: '14px',
                cursor: (isLoading || isLoadingHistory || isStreaming) ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              {isStreaming ? 'Streaming...' : 'Stream'}
            </Button>
          </div>
          

          
          {/* Clean interface - no voice level or transcribed text display */}
        </Form>
      </div>
    </div>
  );
};

export default DentalChatPopup;