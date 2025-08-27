/**
 * Text-to-Speech utility using browser's native Web Speech API
 * Includes pause/resume functionality and audio controls
 * Automatically detects and uses high-quality voices (including Neural2 if available)
 */

class TextToSpeech {
  constructor() {
    this.isPlaying = false;
    this.isPaused = false;
    this.currentText = '';
    this.currentUtterance = null;
    this.speechSynthesis = window.speechSynthesis;
    this.preferredVoice = null;
    this.startTime = 0;
    this.pauseTime = 0;
    this.totalPauseTime = 0;
  }

  // Initialize TTS with preferred voice (Neural2 if available)
  async initialize() {
    try {
      // Wait for voices to load
      if (this.speechSynthesis.getVoices().length === 0) {
        await new Promise(resolve => {
          this.speechSynthesis.onvoiceschanged = resolve;
        });
      }

      // Get available voices
      const voices = this.speechSynthesis.getVoices();
      
      // Try to find the most natural human-like female voice
      let preferredVoice = voices.find(voice => 
        (voice.name.includes('Samantha') || 
         voice.name.includes('Alice') || 
         voice.name.includes('Amélie') ||
         voice.name.includes('Anna') ||
         voice.name.includes('Amira') ||
         voice.name.includes('Victoria') ||
         voice.name.includes('Emma') ||
         voice.name.includes('Sophie')) &&
        voice.lang.startsWith('en')
      );

      // Fallback to any female voice
      if (!preferredVoice) {
        preferredVoice = voices.find(voice => 
          voice.name.includes('Samantha') || 
          voice.name.includes('Alice') || 
          voice.name.includes('Amélie') ||
          voice.name.includes('Anna') ||
          voice.name.includes('Amira')
        );
      }

      // Fallback to any high-quality voice
      if (!preferredVoice) {
        preferredVoice = voices.find(voice => 
          voice.name.includes('Neural2') || 
          voice.name.includes('Neural') ||
          voice.name.includes('Google') ||
          voice.name.includes('Premium') ||
          voice.name.includes('Enhanced')
        );
      }

      // Fallback to any available voice
      if (!preferredVoice && voices.length > 0) {
        preferredVoice = voices[0];
      }

      if (preferredVoice) {
        console.log('TTS initialized with voice:', preferredVoice.name);
        this.preferredVoice = preferredVoice;
      } else {
        console.log('No preferred voice found, using default');
      }

      return true;
    } catch (error) {
      console.error('Error initializing TTS:', error);
      return false;
    }
  }

  // Speak text using Web Speech API
  speak(text) {
    if (!this.speechSynthesis) {
      throw new Error('Speech synthesis not supported');
    }

    // Stop any current speech
    this.stop();

    // Create new utterance
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Configure voice
    if (this.preferredVoice) {
      utterance.voice = this.preferredVoice;
    }
    
    utterance.rate = 1.2; // Faster narration for better user experience
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';

    // Set up event handlers
    utterance.onstart = () => {
      this.isPlaying = true;
      this.isPaused = false;
      this.currentUtterance = utterance;
      this.startTime = Date.now();
      this.totalPauseTime = 0;
    };

    utterance.onend = () => {
      this.isPlaying = false;
      this.isPaused = false;
      this.currentUtterance = null;
    };

    utterance.onpause = () => {
      this.isPaused = true;
      this.pauseTime = Date.now();
    };

    utterance.onresume = () => {
      this.isPaused = false;
      if (this.pauseTime > 0) {
        this.totalPauseTime += Date.now() - this.pauseTime;
        this.pauseTime = 0;
      }
    };

    utterance.onerror = (event) => {
      console.error('Speech synthesis error:', event.error);
      this.isPlaying = false;
      this.isPaused = false;
    };

    // Start speaking
    this.speechSynthesis.speak(utterance);
    this.currentText = text;
  }

  // Pause current speech
  pause() {
    if (this.isPlaying && !this.isPaused && this.speechSynthesis) {
      this.speechSynthesis.pause();
      this.isPaused = true;
      this.pauseTime = Date.now();
    }
  }

  // Resume paused speech
  resume() {
    if (this.isPaused && this.speechSynthesis) {
      this.speechSynthesis.resume();
      this.isPaused = false;
      if (this.pauseTime > 0) {
        this.totalPauseTime += Date.now() - this.pauseTime;
        this.pauseTime = 0;
      }
    }
  }

  // Stop speech completely
  stop() {
    if (this.speechSynthesis) {
      this.speechSynthesis.cancel();
    }
    this.isPlaying = false;
    this.isPaused = false;
    this.currentUtterance = null;
    this.currentText = '';
    this.startTime = 0;
    this.pauseTime = 0;
    this.totalPauseTime = 0;
  }

  // Get current status
  getStatus() {
    return {
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      currentText: this.currentText,
      hasPreferredVoice: !!this.preferredVoice
    };
  }

  // Check if TTS is supported
  isSupported() {
    return !!this.speechSynthesis;
  }

  // Get available voices
  getVoices() {
    return this.speechSynthesis ? this.speechSynthesis.getVoices() : [];
  }

  // Change voice
  setVoice(voiceName) {
    const voices = this.getVoices();
    const voice = voices.find(v => v.name === voiceName);
    if (voice) {
      this.preferredVoice = voice;
      console.log('Voice changed to:', voice.name);
      return true;
    }
    return false;
  }

  // Set speech rate
  setRate(rate) {
    if (this.currentUtterance) {
      this.currentUtterance.rate = Math.max(0.1, Math.min(10, rate));
    }
  }

  // Set speech pitch
  setPitch(pitch) {
    if (this.currentUtterance) {
      this.currentUtterance.pitch = Math.max(0, Math.min(2, pitch));
    }
  }

  // Set speech volume
  setVolume(volume) {
    if (this.currentUtterance) {
      this.currentUtterance.volume = Math.max(0, Math.min(1, volume));
    }
  }
}

// Create singleton instance
const ttsInstance = new TextToSpeech();

export default ttsInstance;
