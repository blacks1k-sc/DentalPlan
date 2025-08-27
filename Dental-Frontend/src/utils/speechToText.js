/**
 * Speech-to-Text utility with local Whisper model support and browser fallback
 */

// Check if browser supports speech recognition
export const isSpeechRecognitionSupported = () => {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
};

// Browser-based speech recognition fallback
export const transcribeWithBrowserAPI = () => {
  return new Promise((resolve, reject) => {
    if (!isSpeechRecognitionSupported()) {
      reject(new Error('Speech recognition not supported in this browser'));
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      resolve(transcript);
    };
    
    recognition.onerror = (event) => {
      reject(new Error(event.error));
    };
    
    recognition.onend = () => {
      // Recognition ended
    };
    
    // Start recognition
    recognition.start();
    
    // Set a timeout to avoid hanging
    setTimeout(() => {
      recognition.stop();
      reject(new Error('Recognition timeout'));
    }, 10000);
  });
};

// Local Whisper model implementation (placeholder for future WebAssembly integration)
export const transcribeWithLocalWhisper = async (audioBlob) => {
  // This is a placeholder for local Whisper WebAssembly implementation
  // In the future, this would:
  // 1. Load a pre-trained Whisper model
  // 2. Process the audio blob
  // 3. Return the transcribed text
  
  throw new Error('Local Whisper not yet implemented. Using browser fallback.');
};

// Process audio with fallback strategy
export const processAudioTranscription = async (audioBlob, options = {}) => {
  const { useLocalWhisper = true, useBrowserFallback = true } = options;
  
  try {
    // Try local Whisper first if enabled
    if (useLocalWhisper) {
      try {
        const text = await transcribeWithLocalWhisper(audioBlob);
        if (text && text.trim()) {
          return { text: text.trim(), source: 'whisper' };
        }
      } catch (whisperError) {
        console.log('Local Whisper failed:', whisperError.message);
      }
    }
    
    // Fallback to browser API if enabled
    if (useBrowserFallback) {
      try {
        const text = await transcribeWithBrowserAPI();
        if (text && text.trim()) {
          return { text: text.trim(), source: 'browser' };
        }
      } catch (browserError) {
        console.log('Browser API failed:', browserError.message);
      }
    }
    
    throw new Error('All transcription methods failed');
    
  } catch (error) {
    throw new Error(`Transcription failed: ${error.message}`);
  }
};

// Audio recording utilities
export const createMediaRecorder = (stream, options = {}) => {
  const defaultOptions = {
    mimeType: 'audio/webm',
    audioBitsPerSecond: 128000
  };
  
  const recorderOptions = { ...defaultOptions, ...options };
  
  try {
    return new MediaRecorder(stream, recorderOptions);
  } catch (error) {
    // Fallback to default format if specified format is not supported
    console.warn('Specified audio format not supported, using default:', error.message);
    return new MediaRecorder(stream);
  }
};

// Audio context utilities for voice level visualization
export const createAudioAnalyzer = (stream) => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = audioContext.createAnalyser();
  const microphone = audioContext.createMediaStreamSource(stream);
  
  analyser.fftSize = 256;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  microphone.connect(analyser);
  
  return {
    audioContext,
    analyser,
    microphone,
    bufferLength,
    dataArray,
    getAudioLevel: () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;
      return average;
    },
    cleanup: () => {
      microphone.disconnect();
      audioContext.close();
    }
  };
};
