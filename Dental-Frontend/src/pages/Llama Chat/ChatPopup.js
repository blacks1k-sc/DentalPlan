import React, { useState, useRef, useEffect } from 'react';
import { Button, Form, Input, Popover, PopoverBody } from 'reactstrap';
import sessionManager from "utils/sessionManager"
import axios from 'axios';
import { parsePipeDelimitedTable } from '../../utils/tableParser';
import ttsInstance from '../../utils/textToSpeech';
// Removed speechToText utility import - implementing real-time transcription directly

const DentalChatPopup = ({ isOpen, toggle, target }) => {
  // Add CSS animation for pulse effect
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0% { transform: scale(1); opacity: 0.8; }
        50% { transform: scale(1.2); opacity: 0.4; }
        100% { transform: scale(1); opacity: 0.8; }
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
  
  // Text-to-Speech states
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSpeakingText, setCurrentSpeakingText] = useState('');
  
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const chatWindowRef = useRef(null);
  const dragHandleRef = useRef(null);
  const apiUrl = process.env.REACT_APP_NODEAPIURL;
  const patientId = sessionManager.getItem('patientId');
  const clientId = sessionManager.getItem('clientId');

  // Check if timestamps should be shown
  const showTimestamps = clientId === "67161fcbadd1249d59085f9a";

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
          
          // Update the input field in real-time
          if (finalTranscript) {
            setTranscribedText(finalTranscript);
            setInput(finalTranscript);
          } else if (interimTranscript) {
            // Show interim results as user speaks
            setTranscribedText(interimTranscript);
            setInput(interimTranscript);
          }
        };
        
        recognition.onerror = (event) => {
          console.error('Speech recognition error:', event.error);
        };
        
        recognition.onend = () => {
          console.log('Speech recognition ended');
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
      setTranscribedText('');
      
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
      // Use setTimeout to ensure DOM is updated before scrolling
      setTimeout(scrollToBottom, 0);
    }
  }, [messages, isOpen]);

  // Load chat history when popup opens and patientId is available
  useEffect(() => {
    if (isOpen && patientId) {
      loadChatHistory();
    }
  }, [isOpen, patientId]);

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
    if (!patientId) return;

    setIsLoadingHistory(true);
    try {
      const response = await axios.get(`${apiUrl}/get-chat-history`, {
        params: { patientId },
        headers: {
          Authorization: sessionManager.getItem("token")
        }
      });

      if (response.data.success) {
        // Convert timestamp to match existing message format
        const formattedMessages = response.data.messages.map(msg => ({
          text: msg.text,
          sender: msg.sender,
          isError: msg.isError || false,
          timestamp: msg.timestamp
        }));
        setMessages(formattedMessages);
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const saveChatMessage = async (message) => {
    if (!patientId) return;

    try {
      await axios.post(`${apiUrl}/save-chat-message`, {
        patientId,
        message,
        sender: `${sessionManager.getItem('firstName')} ${sessionManager.getItem('lastName')}`
      }, {
        headers: {
          Authorization: sessionManager.getItem("token")
        }
      });
    } catch (error) {
      console.error('Error saving chat message:', error);
    }
  };

  const startRagJob = async (query) => {
    const response = await axios.post(`${apiUrl}/start-chat-job`, {
      query: query, 
      json: [], // Empty array for now since this is just chat, not annotation-based
      patient_id: sessionStorage.getItem("patientId")
    }, {
      headers: {
        Authorization: sessionManager.getItem("token")
      }
    });
    return response.data.jobId;
  };

  const pollRagJob = async (jobId, maxRetries = 120, interval = 10000) => {
    for (let i = 0; i < maxRetries; i++) {
      const response = await axios.get(`${apiUrl}/chat-job-status/${jobId}`, {
        headers: {
          Authorization: sessionManager.getItem("token")
        }
      });

      const { status, result, error } = response.data;
      if (status === 'completed') return result;
      if (status === 'failed') throw new Error(error);

      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error("Job timeout");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Add user message
    const userMessage = { text: input, sender: `${sessionManager.getItem('firstName')} ${sessionManager.getItem('lastName')}`, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);

    // Save user message to database
    await saveChatMessage(userMessage);

    setInput('');
    setIsLoading(true);

    try {
      // Call backend API with the custom prompt template
      const jobId = await startRagJob(input);
      const ragText = await pollRagJob(jobId);

      // Add bot message
      const botMessage = {
        text: ragText.answer,
        sender: 'bot',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, botMessage]);

      // Save bot message to database
      await saveChatMessage(botMessage);
      
      // Auto-speak AI response (removed - now using individual speaker buttons)
    } catch (error) {
      console.error('Error:', error);
      const errorMessage = {
        text: 'Sorry, I encountered an error. Please try again.',
        sender: 'bot',
        isError: true,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);

      // Save error message to database
      await saveChatMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChatHistory = async () => {
    if (!patientId) return;

    try {
      // Show loading state
      setIsLoading(true);
      
      await axios.post(`${apiUrl}/clear-chat-history`, {
        patientId
      }, {
        headers: {
          Authorization: sessionManager.getItem("token")
        }
      });
      
      // Clear messages and show success feedback
      setMessages([]);
      
      // Optional: Show a brief success message
      // You can add a toast notification here if you have one
      console.log('Chat history cleared successfully');
      
    } catch (error) {
      console.error('Error clearing chat history:', error);
      // Optional: Show error message to user
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
            {messages.length > 0 && (
              <Button
                onClick={clearChatHistory}
                className="border-0 px-2 py-1 text-xs"
                title="Clear chat history"
                disabled={isLoading}
                style={{
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  opacity: isLoading ? 0.6 : 1,
                }}
              >
                {isLoading ? 'Clearing...' : 'Clear'}
              </Button>
            )}
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
              {messages.map((msg, index) => (
                <div
                  key={index}
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
                        `${msg.sender}: ${msg.text}`
                      ) : (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                            <span>Oral Wisdom AI:</span>
                          </div>
                          
                          <div dangerouslySetInnerHTML={{ __html: parsePipeDelimitedTable(msg.text) }} />
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
              ))}
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
          onSubmit={handleSubmit}
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

            {/* Main Speaker Button for Input Field */}
            <Button
              type="button"
              onClick={() => {
                if (isSpeaking && currentSpeakingText === input) {
                  stopSpeech();
                } else {
                  speakText(input);
                }
              }}
              disabled={isLoading || isLoadingHistory || !input.trim()}
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: '4px',
                width: '40px',
                height: '40px',
                padding: '0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: (isLoading || isLoadingHistory || !input.trim()) ? 'not-allowed' : 'pointer',
                flexShrink: 0,
                position: 'relative'
              }}
              title={(isSpeaking && currentSpeakingText === input) ? 'Stop Speaking' : 'Speak Input Text'}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#f0f0f0'}
              onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
            >
              <i 
                className={(isSpeaking && currentSpeakingText === input) ? 'ion ion-md-close' : 'ion ion-md-volume-high'} 
                style={{ 
                  color: (isSpeaking && currentSpeakingText === input) ? '#dc3545' : '#6c757d', 
                  fontSize: '18px' 
                }} 
              />
            </Button>

            {/* Main Pause/Resume Button (only show when speaking input text) */}
            {isSpeaking && currentSpeakingText === input && (
              <Button
                type="button"
                onClick={isPaused ? resumeSpeech : pauseSpeech}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  width: '40px',
                  height: '40px',
                  padding: '0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
                title={isPaused ? 'Resume Speaking' : 'Pause Speaking'}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#f0f0f0'}
                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
              >
                <i 
                  className={isPaused ? 'ion ion-md-play' : 'ion ion-md-pause'} 
                  style={{ 
                    color: isPaused ? '#28a745' : '#6c757d', 
                    fontSize: '18px' 
                  }} 
                />
              </Button>
            )}


            
            <Button
              type="submit"
              disabled={isLoading || isLoadingHistory}
              style={{
                backgroundColor: 'var(--bs-primary, #007bff)',
                border: 'none',
                borderRadius: '4px',
                padding: '8px 16px',
                color: 'white',
                fontSize: '14px',
                cursor: (isLoading || isLoadingHistory) ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              Send
            </Button>
          </div>
          

          
          {/* Clean interface - no voice level or transcribed text display */}
        </Form>
      </div>
    </div>
  );
};

export default DentalChatPopup;