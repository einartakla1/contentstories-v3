import React, { useState, useEffect, useRef } from "react";
import { registerVevComponent, useEditorState } from "@vev/react";
import { VideoIcon } from './icons';
import { Volume2, VolumeOff, Pause, ChevronUp, ChevronDown } from 'lucide-react';
import { Helmet } from 'react-helmet';
import styles from './ContentStoriesV3.module.css';

declare global {
  interface Window {
    jwplayer: any;
  }

  interface Navigator {
    connection?: {
      effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
      type?: 'bluetooth' | 'cellular' | 'ethernet' | 'none' | 'wifi' | 'wimax' | 'other' | 'unknown';
      downlink?: number;
      downlinkMax?: number;
      rtt?: number;
      saveData?: boolean;
      addEventListener: (type: string, listener: EventListener) => void;
      removeEventListener: (type: string, listener: EventListener) => void;
    };
  }
}

type ImageProp = { url: string };

type Props = {
  initialPlaylistId: string;
  initialMediaId: string;
  topText: string;
  logo: ImageProp;
  inputLogoLink: string;
  inputCtaLink: string;
  inputCtaTekst: string;
  inputCtaImage: ImageProp;
  titleDisplayTime: number;
  ctaDisplayTime: number;
  showUnmuteTextTime: number;
  testDNApp: boolean;
  showDisclaimer: boolean;
  disclaimerHeading: string;
  disclaimerText: string;
};

// Caption type definition
type Caption = {
  start: number;
  end: number;
  text: string;
};

const formatTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const DNAPP_BOTTOM_SPACING = 80; // Change from 100px to 80px
const CAPTION_TOLERANCE = 0.1; // 100ms tolerance for caption matching



const ContentStoriesV3: React.FC<Props> = ({
  initialPlaylistId,
  initialMediaId,
  topText,
  logo,
  inputLogoLink,
  inputCtaLink,
  inputCtaTekst,
  inputCtaImage,
  titleDisplayTime,
  ctaDisplayTime,
  showUnmuteTextTime,
  testDNApp,
  showDisclaimer,
  disclaimerHeading,
  disclaimerText

}) => {
  // Core state
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [isMuted, setIsMuted] = useState(true);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isInDNApp, setIsInDNApp] = useState<boolean>(false);
  const [jwPlayerLoaded, setJwPlayerLoaded] = useState(false);

  // UI state
  const [titles, setTitles] = useState<{ [key: string]: string }>({});
  const [currentTimes, setCurrentTimes] = useState<{ [key: string]: number }>({});
  const [durations, setDurations] = useState<{ [key: string]: number }>({});
  const [seekPercentages, setSeekPercentages] = useState<{ [key: string]: number }>({});
  const [showTitles, setShowTitles] = useState<{ [key: string]: boolean }>({});
  const [showCtaElements, setShowCtaElements] = useState<{ [key: string]: boolean }>({});
  const [safeAreaInsets, setSafeAreaInsets] = useState({
    top: 0, right: 0, bottom: 0, left: 0
  });
  const [showUnmuteText, setShowUnmuteText] = useState<boolean>(true);
  const [showingUnmuteTextForVideos, setShowingUnmuteTextForVideos] = useState<Set<string>>(new Set());
  const [videosWithDisclaimerOpen, setVideosWithDisclaimerOpen] = useState<Set<string>>(new Set());


  // Cache
  const _fetchCache = new Map<string, any>();


  // Caption state
  const [captionsData, setCaptionsData] = useState<{ [key: string]: Caption[] }>({});

  // Add state for CTA content and captions from JW Player
  const [ctaContent, setCtaContent] = useState<{ [key: string]: { text: string, link: string } }>({});

  // Player state tracking
  const [pausedPlayers, setPausedPlayers] = useState<Set<string>>(new Set());
  const [initializedPlayers, setInitializedPlayers] = useState<Set<string>>(new Set());
  const [playersReady, setPlayersReady] = useState<Set<string>>(new Set());

  // Refs
  const isMountedRef = useRef<boolean>(true);
  const pendingOperationsRef = useRef<{ [key: string]: boolean }>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const playerInstancesRef = useRef<{ [key: string]: any }>({});
  const observerRef = useRef<IntersectionObserver | null>(null);
  const userScrollingRef = useRef<boolean>(false);
  const unmutedRef = useRef<boolean>(false); // Reference to track unmuted state
  const captionFetchAttemptsRef = useRef<{ [key: string]: number }>({});
  const initialLoadingRef = useRef(false);


  const { disabled } = useEditorState();


  // SRT parser function
  const fetchAndParseSRT = async (url: string, mediaId: string) => {
    // Skip if we've already tried too many times
    if (!captionFetchAttemptsRef.current[mediaId]) {
      captionFetchAttemptsRef.current[mediaId] = 0;
    }

    if (captionFetchAttemptsRef.current[mediaId] >= 3) {
      return;
    }

    captionFetchAttemptsRef.current[mediaId]++;

    try {
      // Only fetch captions for active or next video to save bandwidth
      const isActiveOrNextVideo =
        activeIndex !== null &&
        (mediaIds[activeIndex] === mediaId ||
          (activeIndex < mediaIds.length - 1 && mediaIds[activeIndex + 1] === mediaId));

      // If it's not the active or next video and we're on mobile with limited bandwidth,
      // skip fetching captions for now
      if (!isActiveOrNextVideo && isMobile && navigator.connection?.saveData) {
        return;
      }

      const response = await fetch(url);
      if (!response.ok) return;

      const text = await response.text();
      if (!text.includes('-->')) return;

      // Parse the SRT file in a non-blocking way
      setTimeout(() => {
        if (!isMountedRef.current) return;
        const captions = parseSRT(text);
        if (captions.length > 0) {
          setCaptionsData(prev => ({ ...prev, [mediaId]: captions }));
        }
      }, 10);
    } catch (error) {
      console.error(`Error parsing captions for ${mediaId}:`, error);
    }
  };

  const parseSRT = (text: string): Caption[] => {
    const captions: Caption[] = [];

    // Normalize line endings and prepare the text
    const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split into caption blocks - empty line is the separator
    const blocks = normalizedText.split(/\n\s*\n/);

    // Process each caption block
    blocks.forEach((block, index) => {
      try {
        const lines = block.trim().split('\n');

        if (lines.length >= 2) {
          // Find the timecode line (contains -->)
          const timecodeLineIndex = lines.findIndex(line => line.includes('-->'));
          if (timecodeLineIndex === -1) return;

          const timeLine = lines[timecodeLineIndex];
          // Flexible regex to match various SRT time formats
          const timeMatch = timeLine.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);

          if (timeMatch) {
            const startHours = parseInt(timeMatch[1]);
            const startMins = parseInt(timeMatch[2]);
            const startSecs = parseInt(timeMatch[3]);
            const startMs = parseInt(timeMatch[4]);
            const endHours = parseInt(timeMatch[5]);
            const endMins = parseInt(timeMatch[6]);
            const endSecs = parseInt(timeMatch[7]);
            const endMs = parseInt(timeMatch[8]);

            const startTime = (startHours * 3600) + (startMins * 60) + startSecs + (startMs / 1000);
            const endTime = (endHours * 3600) + (endMins * 60) + endSecs + (endMs / 1000);

            // Text content is everything after timecode line
            const textContent = lines.slice(timecodeLineIndex + 1).join('\n');

            if (textContent.trim()) {
              captions.push({
                start: startTime,
                end: endTime,
                text: textContent.trim()
              });
            }
          }
        }
      } catch (e) {
        console.warn(`Error parsing caption block ${index}:`, e);
      }
    });

    // Log the first few captions for debugging
    if (captions.length > 0) {
      console.log(`First few captions parsed:`, captions.slice(0, 3));
    }

    return captions;
  };

  // Improved fetch with retry function
  const fetchWithRetry = async (url: string, retries = 3, delay = 300): Promise<any> => {
    try {
      // Check cache first for identical URLs
      if (_fetchCache.has(url)) {
        return _fetchCache.get(url);
      }

      // Original fetch implementation with retries
      let lastError;
      for (let i = 0; i < retries; i++) {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP error ${response.status}`);
          const data = await response.json();

          // Cache successful results
          _fetchCache.set(url, data);
          return data;
        } catch (error) {
          console.warn(`Fetch attempt ${i + 1} failed for ${url}`, error);
          lastError = error;

          if (i < retries - 1) {
            await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
          }
        }
      }
      throw lastError;
    } catch (error) {
      console.error(`Fetch error for ${url}:`, error);
      // Return null or empty object to prevent crashes
      return null;
    }
  };

  // Load JW Player script
  useEffect(() => {
    if (window.jwplayer) {
      setJwPlayerLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = "https://cdn.jwplayer.com/libraries/VKKKd3wX.js";
    script.async = true;
    script.onload = () => {
      if (isMountedRef.current) {
        setJwPlayerLoaded(true);
      }
    };
    document.body.appendChild(script);

    return () => {
      const existingScript = document.querySelector(`script[src="${script.src}"]`);
      if (existingScript && existingScript.parentNode) {
        existingScript.parentNode.removeChild(existingScript);
      }
    };
  }, []);

  // Device detection
  useEffect(() => {
    const userAgentString = navigator.userAgent;
    const isInDNAppValue = userAgentString.includes("DNApp") || testDNApp; // Add testDNApp here
    setIsInDNApp(isInDNAppValue);

    // Set a data attribute on the body element to enable DNApp-specific CSS
    if (isInDNAppValue) {
      document.body.setAttribute('data-dnapp', 'true');
      document.documentElement.style.setProperty('--dnapp-bottom-spacing', `${DNAPP_BOTTOM_SPACING}px`);

    } else {
      document.body.removeAttribute('data-dnapp');
      document.documentElement.style.removeProperty('--dnapp-bottom-spacing');
    }

    // Rest of the effect remains the same...
    const handleResize = () => {
      if (!isMountedRef.current) return;
      setIsMobile(window.innerWidth <= 768);

      // Get safe area insets
      const computedStyle = window.getComputedStyle(document.documentElement);
      const safeTop = parseInt(computedStyle.getPropertyValue('--sat') || '0', 10);
      const safeRight = parseInt(computedStyle.getPropertyValue('--sar') || '0', 10);
      const safeBottom = parseInt(computedStyle.getPropertyValue('--sab') || '0', 10);
      const safeLeft = parseInt(computedStyle.getPropertyValue('--sal') || '0', 10);

      setSafeAreaInsets({
        top: safeTop || 0,
        right: safeRight || 0,
        bottom: safeBottom || 0,
        left: safeLeft || 0
      });
    };

    // Set iOS safe area variables
    const setIOSSafeAreaVariables = () => {
      if ('CSS' in window && CSS.supports('top: env(safe-area-inset-top)')) {
        document.documentElement.style.setProperty('--sat', 'env(safe-area-inset-top)');
        document.documentElement.style.setProperty('--sar', 'env(safe-area-inset-right)');
        document.documentElement.style.setProperty('--sab', 'env(safe-area-inset-bottom)');
        document.documentElement.style.setProperty('--sal', 'env(safe-area-inset-left)');
      }
    };

    setIOSSafeAreaVariables();
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      // Clean up the data attribute when component unmounts
      document.body.removeAttribute('data-dnapp');
    };
  }, [testDNApp]);

  // Clean up on unmount
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      // Clean up all player instances
      Object.keys(playerInstancesRef.current).forEach(mediaId => {
        try {
          if (playerInstancesRef.current[mediaId]) {
            window.jwplayer(`jwplayer-${mediaId}`).remove();
          }
        } catch (e) {
          console.error(`Error removing player ${mediaId}:`, e);
        }
      });
    };
  }, []);

  // Fetch playlist data
  useEffect(() => {
    const fetchPlaylist = async () => {
      if (!initialPlaylistId) {
        if (initialMediaId) setMediaIds([initialMediaId]);
        return;
      }

      try {
        const data = await fetchWithRetry(`https://cdn.jwplayer.com/v2/playlists/${initialPlaylistId}`);
        if (!isMountedRef.current) return;

        let orderedPlaylist = [...data.playlist];

        // Get mediaId from URL parameter if it exists
        const urlParams = new URLSearchParams(window.location.search);
        const queryMediaId = urlParams.get('mediaid');
        const priorityMediaId = queryMediaId || initialMediaId;

        // Reorder playlist if needed
        if (priorityMediaId) {
          const initialIndex = orderedPlaylist.findIndex((item: any) => item.mediaid === priorityMediaId);
          if (initialIndex > -1) {
            const [initialItem] = orderedPlaylist.splice(initialIndex, 1);
            orderedPlaylist = [initialItem, ...orderedPlaylist];
          }
        }

        // Process custom parameters for CTA content
        orderedPlaylist.forEach((item: any) => {
          const mediaId = item.mediaid;

          // Check for custom parameters at the root level of the item
          const ctaText = item.cStoriesCtaText;
          const ctaLink = item.cStoriesCtaLink;

          if (ctaText || ctaLink) {
            console.log(`Found custom parameters for ${mediaId}: Text=${ctaText}, Link=${ctaLink}`);
            setCtaContent(prev => ({
              ...prev,
              [mediaId]: {
                text: ctaText || '',
                link: ctaLink || ''
              }
            }));
          }
        });

        setMediaIds(orderedPlaylist.map((item: any) => item.mediaid));
      } catch (err) {
        console.error("Error fetching playlist:", err);
      }
    };

    fetchPlaylist();
  }, [initialPlaylistId, initialMediaId]);

  // Update UI state for video
  const updateVideoUIState = (mediaId: string, position: number, duration: number) => {
    const percentage = (position / duration) * 100;

    // Update time and seek states
    setCurrentTimes(prev => ({ ...prev, [mediaId]: position }));
    setDurations(prev => ({ ...prev, [mediaId]: duration }));
    setSeekPercentages(prev => ({ ...prev, [mediaId]: percentage }));

    // Update title/CTA visibility
    const shouldShowTitle = titleDisplayTime > 0 && position <= titleDisplayTime;
    const shouldShowCta = ctaDisplayTime > 0 && position >= ctaDisplayTime;

    if (showTitles[mediaId] !== shouldShowTitle) {
      setShowTitles(prev => ({ ...prev, [mediaId]: shouldShowTitle }));
    }

    if (showCtaElements[mediaId] !== shouldShowCta) {
      setShowCtaElements(prev => ({ ...prev, [mediaId]: shouldShowCta }));
    }

    // Update current caption based on position

  };

  // Preload all players without starting them
  useEffect(() => {
    if (!jwPlayerLoaded || mediaIds.length === 0) return;

    // For each media ID, initialize the player instance
    mediaIds.forEach((mediaId, index) => {
      if (!initializedPlayers.has(mediaId) && !pendingOperationsRef.current[mediaId]) {
        initializePlayer(mediaId, index, true); // true means preload only
      }
    });
  }, [jwPlayerLoaded, mediaIds]);


  // Add this ref with your other refs
  const hasTriggeredInitialPlayRef = useRef(false);
  const autoplayAttemptsRef = useRef(0);


  // Create a function that extracts the playback logic from your intersection observer
  // Place this with your other functions
  const playVideo = (mediaId: string, index: number) => {
    // Set active index
    setActiveIndex(index);

    console.log(`Playing video ${mediaId} (muted: ${isMuted}, unmutedRef: ${unmutedRef.current})`);

    if (playersReady.has(mediaId)) {
      const player = playerInstancesRef.current[mediaId];
      if (player) {
        // Always reset to beginning 
        player.seek(0);

        setPausedPlayers(prev => {
          const newSet = new Set([...prev]);
          newSet.delete(mediaId);
          return newSet;
        });

        // Apply mute state based on global state and unmutedRef
        const shouldBeMuted = unmutedRef.current ? false : isMuted;

        // Important: On mobile, always start muted then unmute after playback begins
        if (isMobile) {
          // Always start muted first
          player.setMute(true);
          player.play();

          // Then unmute if needed after a brief delay
          if (!shouldBeMuted) {
            setTimeout(() => {
              if (player) {
                player.setMute(false);
                console.log(`Unmuting player ${mediaId} after starting playback`);
              }
            }, 250);
          }
        } else {
          // Desktop doesn't need the special handling
          player.setMute(shouldBeMuted);
          player.play();
        }

        // Clear from paused players
        setPausedPlayers(prev => {
          const newSet = new Set([...prev]);
          newSet.delete(mediaId);
          return newSet;
        });

        // Reset UI states
        setShowTitles(prev => ({ ...prev, [mediaId]: true }));
        setShowCtaElements(prev => ({ ...prev, [mediaId]: false }));
      }
    }
    preloadNextVideo(index);
  };


  useEffect(() => {
    // Skip if we don't have videos or JW Player isn't loaded
    if (!jwPlayerLoaded || mediaIds.length === 0) return;

    // Skip if we've already triggered play or too many attempts
    if (hasTriggeredInitialPlayRef.current || autoplayAttemptsRef.current > 2) return;

    // Skip if we already have an active video
    if (activeIndex !== null) return;

    const firstMediaId = mediaIds[0];

    // Check if the player is ready
    if (playersReady.has(firstMediaId)) {
      console.log(`Retry attempt ${autoplayAttemptsRef.current + 1}: Ensuring first video autoplay`);
      autoplayAttemptsRef.current += 1;

      // Try to play if it's not already playing
      const player = playerInstancesRef.current[firstMediaId];
      if (player && player.getState() !== 'playing') {
        player.setMute(true); // Always muted for first load
        player.play();
        setActiveIndex(0);
      }
    }

    // Schedule another check in case current attempt didn't work
    const retryTimeout = setTimeout(() => {
      if (isMountedRef.current && !hasTriggeredInitialPlayRef.current) {
        // Force a re-run of this effect
        setIsMuted(prev => prev);
      }
    }, 1000);

    return () => clearTimeout(retryTimeout);
  }, [jwPlayerLoaded, mediaIds, playersReady, activeIndex]);

  const resetInactiveVideo = (mediaId: string) => {
    if (playersReady.has(mediaId)) {
      const player = playerInstancesRef.current[mediaId];
      if (player) {
        // Only reset if the player isn't already at the beginning
        const currentPosition = player.getPosition();
        if (currentPosition > 0.5) { // Half-second threshold to avoid unnecessary resets
          console.log(`Resetting position for inactive video ${mediaId}`);
          player.seek(0);

          // Also update the UI state to reflect the reset
          updateVideoUIState(mediaId, 0, player.getDuration());
          //REmove pause indicator
          setPausedPlayers(prev => {
            const newSet = new Set([...prev]);
            newSet.delete(mediaId);
            return newSet;
          });
        }
      }
    }
  };


  // Set up intersection observer to detect current video
  useEffect(() => {
    if (!jwPlayerLoaded || mediaIds.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const mediaId = entry.target.getAttribute('data-mediaid') || '';
          const index = parseInt(entry.target.getAttribute('data-index') || '0');

          if (entry.isIntersecting && entry.intersectionRatio >= 0.8) {
            const isNewActiveVideo = activeIndex !== index;
            setActiveIndex(index);

            if (isNewActiveVideo) {
              console.log(`Video ${mediaId} is now active (muted: ${isMuted}, unmutedRef: ${unmutedRef.current})`);

              if (playersReady.has(mediaId)) {
                const player = playerInstancesRef.current[mediaId];
                if (player) {
                  // Always reset to beginning when scrolling to a video
                  player.seek(0);

                  // Apply mute state based on global state and unmutedRef
                  const shouldBeMuted = unmutedRef.current ? false : isMuted;

                  // Important: On mobile, always start muted then unmute after playback begins
                  if (isMobile) {
                    // Always start muted first
                    player.setMute(true);
                    player.play();

                    // Then unmute if needed after a brief delay
                    if (!shouldBeMuted) {
                      setTimeout(() => {
                        if (player) {
                          player.setMute(false);
                          console.log(`Unmuting player ${mediaId} after starting playback`);
                        }
                      }, 250);
                    }
                  } else {
                    // Desktop doesn't need the special handling
                    player.setMute(shouldBeMuted);
                    player.play();
                  }

                  // Clear from paused players if user didn't manually pause
                  if (!pausedPlayers.has(mediaId) || userScrollingRef.current) {
                    setPausedPlayers(prev => {
                      const newSet = new Set([...prev]);
                      newSet.delete(mediaId);
                      return newSet;
                    });
                  }


                  // Reset UI states
                  setShowTitles(prev => ({ ...prev, [mediaId]: true }));
                  setShowCtaElements(prev => ({ ...prev, [mediaId]: false }));
                }
              } else if (initializedPlayers.has(mediaId)) {
                console.log(`Player ${mediaId} initialized but not ready yet, playing when ready`);
              } else {
                // Initialize this player if not already initialized
                initializePlayer(mediaId, index, false);
              }

              // Pause other videos
              mediaIds.forEach(id => {
                if (id !== mediaId && playersReady.has(id)) {
                  try {
                    const player = playerInstancesRef.current[id];
                    if (player && player.getState() === 'playing') {
                      player.pause();
                    }
                  } catch (e) {
                    console.error(`Error pausing player ${id}:`, e);
                  }
                }
              });
            }
          }
          else if (!entry.isIntersecting && entry.intersectionRatio < 0.2) {
            // Reset the video when it's no longer visible
            resetInactiveVideo(mediaId);
          }
        });
      },
      { threshold: [0.2, 0.8] }
    );

    // Observe all video containers
    mediaIds.forEach((mediaId, index) => {
      const element = videoRefs.current[mediaId];
      if (element) {
        observerRef.current?.observe(element);
      }
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [jwPlayerLoaded, mediaIds, initializedPlayers, playersReady, activeIndex, isMuted, isMobile]);


  const preloadNextVideo = (currentIndex: number) => {
    // Skip if there's no next video
    if (currentIndex >= mediaIds.length - 1) return;

    const nextIndex = currentIndex + 1;
    const nextMediaId = mediaIds[nextIndex];

    // Skip if it's already initialized or being initialized
    if (initializedPlayers.has(nextMediaId) || pendingOperationsRef.current[nextMediaId]) return;

    console.log(`Preloading next video: ${nextMediaId}`);
    initializePlayer(nextMediaId, nextIndex, true);
  };


  // Keyboard navigation for desktop
  useEffect(() => {
    if (isMobile || !containerRef.current) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (mediaIds.length === 0 || activeIndex === null) return;

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();

        const newIndex = event.key === 'ArrowUp'
          ? Math.max(activeIndex - 1, 0)
          : Math.min(activeIndex + 1, mediaIds.length - 1);

        if (newIndex !== activeIndex) {
          transitionToVideo(activeIndex, newIndex);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mediaIds, activeIndex, isMobile]);

  // Initialize a player
  const initializePlayer = async (mediaId: string, index: number, preloadOnly: boolean = false) => {
    if (!jwPlayerLoaded || initializedPlayers.has(mediaId) || pendingOperationsRef.current[mediaId]) return;

    pendingOperationsRef.current[mediaId] = true;

    try {
      const data = await fetchWithRetry(`https://cdn.jwplayer.com/v2/media/${mediaId}`);
      if (!isMountedRef.current || !data) return;

      const videoItem = data.playlist[0];

      // Keep the original state updates that work
      setTitles(prev => ({ ...prev, [mediaId]: videoItem.title }));
      setShowTitles(prev => ({ ...prev, [mediaId]: true }));
      setShowCtaElements(prev => ({ ...prev, [mediaId]: false }));

      // Check for custom parameters
      if (videoItem.custom && typeof videoItem.custom === 'object') {
        const ctaText = videoItem.custom.cStoriesCtaText;
        const ctaLink = videoItem.custom.cStoriesCtaLink;

        if (ctaText || ctaLink) {
          setCtaContent(prev => ({
            ...prev,
            [mediaId]: {
              text: ctaText || '',
              link: ctaLink || ''
            }
          }));
        }
      }

      // Check for captions track - only process if active or preload is false
      if (!preloadOnly || index === activeIndex) {
        if (videoItem.tracks && videoItem.tracks.length > 0) {
          const captionTracks = videoItem.tracks.filter((track: any) =>
            track.kind === 'captions' || track.kind === 'subtitles'
          );

          if (captionTracks.length > 0) {
            const firstCaptionTrack = captionTracks[0];
            if (firstCaptionTrack && firstCaptionTrack.file) {
              fetchAndParseSRT(firstCaptionTrack.file, mediaId);
            }
          }
        }
      }

      // Initialize JW Player with optimized settings
      const player = window.jwplayer(`jwplayer-${mediaId}`);
      playerInstancesRef.current[mediaId] = player;

      // Setup player with optimized config
      player.setup({
        playlist: [{
          mediaid: mediaId,
          title: videoItem.title,
          sources: videoItem.sources,
          tracks: videoItem.tracks || []
        }],
        mute: false,
        autostart: index === 0, // Do not autostart on setup
        controls: false,
        width: '100%',
        height: '100%',
        preload: 'auto',
        androidhls: true,
        backgroundcolor: '#13264A',
        stretching: 'fill',
        aspectratio: false,
        primary: 'html5',
        hlsjsdefault: true,
        // Mobile settings 
        mobileSettings: {
          autostart: false, // Don't autostart yet
          mute: true
        }
      });

      // Time event for UI updates
      player.on('time', (e: any) => {
        if (!isMountedRef.current) return;
        updateVideoUIState(mediaId, e.position, e.duration);
      });

      // Video complete handler
      player.on('complete', () => {
        if (!isMountedRef.current) return;

        // CRITICAL: Explicitly pause and mute the current video to stop any audio
        player.pause();
        player.setMute(true);

        // Auto-play next video
        if (index < mediaIds.length - 1) {
          const nextVideoEl = videoRefs.current[mediaIds[index + 1]];
          nextVideoEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });

      // Ready event handler
      player.on('ready', () => {
        if (!isMountedRef.current) return;

        console.log(`Player ready for ${mediaId}`);
        setInitializedPlayers(prev => new Set([...prev, mediaId]));
        setPlayersReady(prev => new Set([...prev, mediaId]));


        const videoElement = document.querySelector(`#jwplayer-${mediaId} video`);
        if (videoElement instanceof HTMLElement) {
          // Default setup - keep object-fit: cover to fill the container
          videoElement.style.objectFit = "cover";
          videoElement.style.objectPosition = "center bottom"; // Keep bottom alignment
          videoElement.style.top = "auto";
          videoElement.style.bottom = "0";

          // Apply different settings for DNApp mode
          if (isInDNApp) {
            // Keep "cover" to maintain filling behavior while allowing cropping
            // This maintains the bottom alignment while ensuring full width
            videoElement.style.objectFit = "cover";

            // This pulls the video up while maintaining bottom alignment
            videoElement.style.transform = "translateY(-75px)";

            // Set to 100% width to ensure the video spans the full container width
            videoElement.style.width = "100%";
            videoElement.style.maxWidth = "none";

            // Make sure the video is positioned properly
            videoElement.style.left = "0";
            videoElement.style.right = "0";

            // Also update the container for full width
            const playerContainer = document.querySelector(`#jwplayer-${mediaId}`);
            if (playerContainer instanceof HTMLElement) {
              playerContainer.style.overflow = "hidden";
              playerContainer.style.width = "100%";
              playerContainer.style.maxWidth = "none";
            }

            // Target the video wrapper for full width
            const videoWrapper = document.querySelector(`.${styles.videoWrapper}`);
            if (videoWrapper instanceof HTMLElement) {
              videoWrapper.style.overflow = "hidden";
              videoWrapper.style.width = "100%";
              videoElement.style.position = "absolute"; // Ensure absolute positioning
              videoWrapper.style.maxWidth = "none";
            }

            // Ensure video container doesn't constrain width
            const videoContainer = document.querySelector(`.${styles.videoContainer}`);
            if (videoContainer instanceof HTMLElement) {
              videoContainer.style.overflow = "hidden";
              videoContainer.style.width = "100%";
            }
          } else {
            // Regular positioning
            videoElement.style.transform = "translateX(0%)";
          }
        }



        // For first video, let autostart handle it (already set in setup)
        // Just mark it as triggered when ready
        if (index === 0) {
          hasTriggeredInitialPlayRef.current = true;
          setActiveIndex(0);

          // Always muted for first load
          player.setMute(true);
        }
        // For other videos, keep the existing active video logic
        else if (index === activeIndex && !preloadOnly) {
          if (isMobile) {
            // On mobile always start muted (will unmute after if needed)
            player.setMute(true);
            player.play();

            // If we need to be unmuted, do it after a short delay
            if (!isMuted || unmutedRef.current) {
              unmutedRef.current = true; // Set the reference
              setTimeout(() => {
                try {
                  if (player) {
                    player.setMute(false);
                    console.log(`Unmuting player ${mediaId} after ready`);
                  }
                } catch (e) {
                  console.error("Error unmuting on ready:", e);
                }
              }, 250);
            }
          } else {
            // On desktop apply unmuted state if user previously unmuted
            const shouldBeMuted = unmutedRef.current ? false : isMuted;
            player.setMute(shouldBeMuted);
            player.play();
          }
        }

        // Check for caption tracks again in case they weren't in the initial data
        const captionsList = player.getCaptionsList();
        if (captionsList && captionsList.length > 1) { // Index 0 is usually "Off"
          console.log(`Captions available from player for ${mediaId}:`, captionsList);

          // If we haven't already loaded captions, try to get them from the first track
          if (!captionsData[mediaId]) {
            const firstTrack = captionsList[1];
            if (typeof firstTrack.id === 'string' && (
              firstTrack.id.endsWith('.srt') ||
              firstTrack.id.endsWith('.vtt')
            )) {
              fetchAndParseSRT(firstTrack.id, mediaId);
            }
          }

          // Turn off JW Player's built-in captions since we're using our own
          player.setCurrentCaptions(0);
        }
      });

      player.on('captionsList', (e: any) => {
        // If captions exist, get the URL and load our custom implementation
        if (e.tracks && e.tracks.length > 0) {
          console.log(`Captions available from event for ${mediaId}:`, e.tracks);

          // Find the first caption track
          const captionTrack = e.tracks.find((track: any) => track.id !== "off");

          if (captionTrack && typeof captionTrack.id === 'string' && (
            captionTrack.id.endsWith('.srt') ||
            captionTrack.id.endsWith('.vtt')
          )) {
            fetchAndParseSRT(captionTrack.id, mediaId);
          }

          // Turn off JW Player's built-in captions
          player.setCurrentCaptions(0);
        }
      });

      player.on('play', () => {
        // If this is the first video and it's now playing, mark it as triggered
        if (index === 0) {
          console.log("First video now playing, marking autoplay as successful");
          hasTriggeredInitialPlayRef.current = true;
          setActiveIndex(0);
        }
        if (index === activeIndex) {
          preloadNextVideo(index);
        }
      });

      // Error handler with recovery attempt
      player.on('error', (e: any) => {
        console.error(`Player error for ${mediaId}:`, e);

        // Try to recover
        setTimeout(() => {
          if (!isMountedRef.current) return;

          try {
            player.setup({
              playlist: [{
                mediaid: mediaId,
                title: videoItem.title,
                sources: videoItem.sources,
                tracks: videoItem.tracks || []
              }],
              mute: true, // Always start muted, we'll update later
              autostart: false,
              controls: false,
              width: '100%',
              height: '100%',
              preload: 'auto',
              androidhls: true,
              backgroundcolor: '#000000',
              stretching: 'fill',
              aspectratio: false, // Add this missing property

            });

            if (index === activeIndex && !preloadOnly) {
              player.play();

              // Special handling for mobile unmuted
              if (isMobile && (!isMuted || unmutedRef.current)) {
                unmutedRef.current = true; // Set the reference
                setTimeout(() => {
                  if (player) player.setMute(false);
                }, 250);
              }
            }
          } catch (e) {
            console.error("Error recovering player:", e);
          }
        }, 1000);
      });

    } catch (error) {
      console.error(`Error initializing player for ${mediaId}:`, error);
    } finally {
      delete pendingOperationsRef.current[mediaId];
    }
  };

  // Handle video click
  const handleVideoClick = (mediaId: string) => {
    if (!initializedPlayers.has(mediaId)) return;

    const player = playerInstancesRef.current[mediaId];
    if (!player) return;

    // Mark this as an explicit user pause, not auto-pause
    if (player.getState() === 'playing') {
      player.pause();
      setPausedPlayers(prev => new Set([...prev, mediaId]));
    } else {
      player.play();

      // On mobile with unmuted, special handling
      if (isMobile && (!isMuted || unmutedRef.current)) {
        unmutedRef.current = true; // Set the reference
        setTimeout(() => {
          if (player) player.setMute(false);
        }, 250);
      } else {
        // Normal case
        player.setMute(unmutedRef.current ? false : isMuted);
      }

      setPausedPlayers(prev => {
        const newSet = new Set([...prev]);
        newSet.delete(mediaId);
        return newSet;
      });
    }
  };

  // Handle mute toggle
  const handleMute = () => {
    const newMuteState = !isMuted;
    setIsMuted(newMuteState);

    // Update unmuted reference when user explicitly changes mute state
    unmutedRef.current = !newMuteState;

    console.log(`Setting mute state to ${newMuteState ? 'muted' : 'unmuted'}, unmutedRef: ${unmutedRef.current}`);

    if (!newMuteState) {
      setShowUnmuteText(false);

      // Also clear any currently showing text
      setShowingUnmuteTextForVideos(new Set());
    }


    // Apply to all initialized players
    mediaIds.forEach(mediaId => {
      if (playersReady.has(mediaId)) {
        const player = playerInstancesRef.current[mediaId];
        if (player) {
          // Special handling for mobile when unmuting
          if (isMobile && !newMuteState && activeIndex !== null && mediaId === mediaIds[activeIndex]) {
            // The two-step approach: ensure we're playing first
            if (player.getState() !== 'playing') {
              player.play();
            }

            // Then unmute after a brief delay
            setTimeout(() => {
              if (player) player.setMute(false);
            }, 250);
          } else {
            // Normal case
            player.setMute(newMuteState);
          }
        }
      }
    });
  };

  useEffect(() => {
    if (!isMobile || !showUnmuteText || activeIndex === null || showUnmuteTextTime <= 0) return;

    const currentMediaId = mediaIds[activeIndex];

    // Skip if we're already showing the text for this video (to avoid duplicating timers)
    if (showingUnmuteTextForVideos.has(currentMediaId)) return;

    console.log(`Setting up to show unmute text for video ${currentMediaId}`);

    // Mark that we're showing the unmute text for this video
    setShowingUnmuteTextForVideos(prev => new Set([...prev, currentMediaId]));

    // Set a timeout to hide the unmute text after the configured time
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        console.log(`Unmute text timeout finished for video ${currentMediaId}`);

        // Remove this video from showing text
        setShowingUnmuteTextForVideos(prev => {
          const newSet = new Set([...prev]);
          newSet.delete(currentMediaId);
          return newSet;
        });
      }
    }, showUnmuteTextTime * 1000);

    return () => {
      clearTimeout(timer);
      console.log(`Cleared unmute text timer for video ${currentMediaId}`);
    };
  }, [activeIndex, isMobile, showUnmuteText, showUnmuteTextTime, mediaIds]);

  // Handle navigation between videos
  const transitionToVideo = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= mediaIds.length) return;

    // Mark that we're programmatically scrolling (not a user pause)
    userScrollingRef.current = true;

    // Scroll to the target video
    const targetElement = videoRefs.current[mediaIds[toIndex]];
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Reset the scrolling flag after animation completes
      setTimeout(() => {
        userScrollingRef.current = false;
      }, 1000);
    }
  };

  // Handle seek bar click
  const handleSeek = (e: React.MouseEvent, mediaId: string) => {
    if (!initializedPlayers.has(mediaId)) return;

    const player = playerInstancesRef.current[mediaId];
    if (player) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const percentage = (e.clientX - rect.left) / rect.width;
      player.seek(percentage * player.getDuration());

      // Make sure we're playing after a seek
      if (player.getState() !== 'playing') {
        player.play();

        // Handle mute state correctly
        if (isMobile && (!isMuted || unmutedRef.current)) {
          unmutedRef.current = true; // Set the reference
          setTimeout(() => {
            if (player) player.setMute(false);
          }, 250);
        } else {
          player.setMute(unmutedRef.current ? false : isMuted);
        }

        // Remove from paused set since user wants to play
        setPausedPlayers(prev => {
          const newSet = new Set([...prev]);
          newSet.delete(mediaId);
          return newSet;
        });
      }
    }
  };

  // Helper function to get the current CTA text for a media
  const getCtaText = (mediaId: string): string => {
    // First check if we have a custom CTA text from JW Player
    if (ctaContent[mediaId]?.text) {
      return ctaContent[mediaId].text;
    }

    // Otherwise fall back to the VEV input
    return inputCtaTekst;
  };

  // Helper function to get the current CTA link for a media
  const getCtaLink = (mediaId: string): string => {
    // First check if we have a custom CTA link from JW Player
    if (ctaContent[mediaId]?.link) {
      return ctaContent[mediaId].link;
    }

    // Otherwise fall back to the VEV input
    return inputCtaLink;
  };

  const toggleDisclaimerForVideo = (mediaId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent video click from triggering

    setVideosWithDisclaimerOpen(prev => {
      const newSet = new Set(prev);
      if (newSet.has(mediaId)) {
        newSet.delete(mediaId);
      } else {
        newSet.add(mediaId);
      }
      return newSet;
    });
  };

  // Close disclaimer for a specific video
  const closeDisclaimerForVideo = (mediaId: string) => {
    setVideosWithDisclaimerOpen(prev => {
      const newSet = new Set(prev);
      newSet.delete(mediaId);
      return newSet;
    });
  };





  return (
    <>
      <Helmet>
        <link rel="stylesheet" href="https://static1.dn.no/dn/static/assets/css/nhstfonts.css" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
      </Helmet>

      <div className={styles.container}>
        {/* Top Bar */}
        <div className={styles.topBar}>
          <span className={styles.topText}>{topText}</span>
          {inputLogoLink ? (
            <a href={inputLogoLink} target="_blank" rel="noopener noreferrer">
              <img src={logo?.url} alt="Logo" className={styles.logo} />
            </a>
          ) : (
            <img src={logo?.url} alt="Logo" className={styles.logo} />
          )}
        </div>

        {/* Videos Container */}
        <div className={styles.wrapper} ref={containerRef}>
          {mediaIds.map((mediaId, index) => (
            <div
              key={mediaId}
              ref={el => videoRefs.current[mediaId] = el}
              className={`${styles.videoContainer} ${isInDNApp ? styles.dnAppVideoContainer : ''}`}
              data-index={index}
              data-mediaid={mediaId}
            >
              <div className={`${styles.videoWrapper} ${isInDNApp ? styles.dnAppVideoWrapper : ''}`}>
                {/* Click layer for play/pause */}
                <div
                  className={styles.videoClickLayer}
                  onClick={() => handleVideoClick(mediaId)}
                />

                {/* JW Player container */}
                <div
                  id={`jwplayer-${mediaId}`}
                  className={styles.video}
                />

                {/* Caption rendering - only show when there's an active caption */}
                {(() => {
                  if (!captionsData[mediaId]) return null;

                  const position = currentTimes[mediaId] || 0;
                  const caption = captionsData[mediaId].find(cap =>
                    position >= cap.start - CAPTION_TOLERANCE && position <= cap.end + CAPTION_TOLERANCE
                  );

                  // Only render the container if there's a caption to show
                  if (!caption) return null;

                  return (
                    <div className={`${styles.customCaptionsContainer} ${isInDNApp ? styles.dnAppCustomCaptionsContainer : ''}`}>
                      <div className={styles.customCaptions}>
                        {caption.text.split('\n').map((line, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <br />}
                            {line}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Loading indicator */}
                {(!playersReady.has(mediaId) ||
                  (index === activeIndex &&
                    playersReady.has(mediaId) &&
                    playerInstancesRef.current[mediaId]?.getState() === 'buffering')) && (
                    <div className={styles.loadingIndicator}></div>
                  )}

                {/* Pause indicator - only show for user-initiated pauses */}
                {pausedPlayers.has(mediaId) && playersReady.has(mediaId) && (
                  <div
                    className={styles.pauseIndicator}
                    onClick={() => handleVideoClick(mediaId)}
                  >
                    <VideoIcon size={96} />
                  </div>
                )}

                {/* Video overlay */}
                <div className={`${styles.videoOverlay} ${index === activeIndex ? styles.activeOverlay : styles.inactiveOverlay} ${isInDNApp ? styles.dnAppOverlay : ''}`}>
                  <div className={styles.titleContainer}>

                    {/* CTA box - using the helper functions to get the text and link */}
                    {showCtaElements[mediaId] && (
                      (() => {
                        const ctaText = getCtaText(mediaId);
                        const ctaLink = getCtaLink(mediaId);

                        // Only show if we have text and it's not 'none'
                        if (ctaText && ctaText !== 'none') {
                          return ctaLink ? (
                            <a
                              href={ctaLink}
                              target="_blank"
                              className={`${styles.ctaBox} ${isInDNApp ? styles.dnAppCta : ''}`}
                            >
                              {inputCtaImage?.url && (
                                <div className={styles.ctaImageContainer}>
                                  <img src={inputCtaImage.url} className={styles.ctaImage} alt="CTA" />
                                </div>
                              )}
                              <div className={styles.ctaContent}>
                                {ctaText}
                              </div>
                            </a>
                          ) : (
                            <div className={`${styles.ctaBox} ${isInDNApp ? styles.dnAppCta : ''}`}>
                              <div className={styles.ctaContent}>
                                {ctaText}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      })()
                    )}

                    {/* Title display */}
                    {showTitles[mediaId] && (
                      <div className={styles.title}>
                        {titles[mediaId] || ''}
                      </div>
                    )}
                    <div className={styles.length}>
                      {formatTime(currentTimes[mediaId] || 0)} /
                      {formatTime(durations[mediaId] || 0)}
                    </div>
                  </div>
                </div>

                {/* Seek bar */}
                <div
                  className={`${styles.seekBarContainer} ${index === activeIndex ? styles.activeSeekBar : styles.inactiveSeekBar} ${isInDNApp ? styles.dnAppSeekBar : ''}`}
                >
                  <div
                    className={styles.seekBarProgress}
                    style={{ width: `${seekPercentages[mediaId] || 0}%` }}
                  />
                </div>

                {/* Larger clickable area for seek bar */}
                <div
                  className={`${styles.seekBarClickArea} ${isInDNApp ? styles.dnAppSeekBarClickArea : ''}`}
                  onClick={(e) => handleSeek(e, mediaId)}
                />

                {/* PLACE THE DISCLAIMER HERE - INSIDE videoWrapper, after all other UI elements */}
                {showDisclaimer && (
                  <div className={styles.disclaimerWrapper}>
                    {/* Disclaimer Button */}
                    <div
                      className={`${styles.disclaimerButton} ${videosWithDisclaimerOpen.has(mediaId) ? styles.disclaimerButtonActive : ''}`}
                      onClick={(e) => toggleDisclaimerForVideo(mediaId, e)}
                    >
                      <span className={styles.disclaimerHeading}>{disclaimerHeading}</span>
                      {videosWithDisclaimerOpen.has(mediaId) ? (
                        <span className={styles.disclaimerCloseIcon}>×</span>
                      ) : (
                        <ChevronDown size={16} color="#fff" />
                      )}
                    </div>

                    {/* Disclaimer overlay - shown only when open */}
                    {videosWithDisclaimerOpen.has(mediaId) && (
                      <div
                        className={styles.disclaimerOverlay}
                        onClick={() => closeDisclaimerForVideo(mediaId)}
                      >
                        <div
                          className={styles.disclaimerContent}
                          onClick={(e) => e.stopPropagation()}
                        >

                          <div className={styles.disclaimerBody}>
                            {disclaimerText.split('\n').map((line, i) => (
                              <React.Fragment key={i}>
                                {i > 0 && <br />}
                                {line}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div> {/* END OF VIDEOWRAPPER */}
            </div>

          ))}
        </div>

        {/* Controls */}
        <div className={styles.controls}>
          {/* Mute button - with or without text */}
          <div
            className={`${styles.controlButton} ${isMobile && showUnmuteText && activeIndex !== null &&
              showingUnmuteTextForVideos.has(mediaIds[activeIndex]) &&
              showUnmuteTextTime > 0 ? styles.controlButtonWithText : ''}`}
            onClick={handleMute}
          >
            {isMobile && showUnmuteText && activeIndex !== null &&
              showingUnmuteTextForVideos.has(mediaIds[activeIndex]) &&
              showUnmuteTextTime > 0 && (
                <span className={styles.unmuteText}>Slå på lyd&nbsp;&nbsp;</span>
              )}
            {isMuted && !unmutedRef.current ? <VolumeOff size={16} /> : <Volume2 size={16} />}
          </div>

          {!isMobile && (
            <>
              <div className={styles.controlButton}
                onClick={() => transitionToVideo(activeIndex || 0, Math.max((activeIndex || 0) - 1, 0))}>
                <ChevronUp size={16} color="#fff" />
              </div>
              <div className={styles.controlButton}
                onClick={() => transitionToVideo(activeIndex || 0, Math.min((activeIndex || 0) + 1, mediaIds.length - 1))}>
                <ChevronDown size={16} color="#fff" />
              </div>
            </>
          )}
        </div>

      </div>
    </>
  );
};

registerVevComponent(ContentStoriesV3, {
  name: "ContentStoriesV3",
  props: [
    { name: "initialPlaylistId", type: "string", initialValue: "" },
    { name: "initialMediaId", type: "string", initialValue: "" },
    { name: "topText", type: "string", initialValue: "" },
    { name: "logo", type: "image" },
    { name: "titleDisplayTime", type: "number", initialValue: 4 },
    { name: "inputLogoLink", type: "string" },
    { name: "inputCtaImage", type: "image" },
    { name: "inputCtaTekst", type: "string" },
    { name: "inputCtaLink", type: "string" },
    { name: "ctaDisplayTime", type: "number", initialValue: 5 },
    { name: "showUnmuteTextTime", type: "number", initialValue: 5, description: "Time in seconds to show unmute text (0 = disabled)" },
    { name: "testDNApp", type: "boolean", initialValue: false, description: "Enable to test DNApp mode (for development only)" },
    { name: "showDisclaimer", type: "boolean", initialValue: false, description: "Show disclaimer message" },
    { name: "disclaimerHeading", type: "string", initialValue: "", description: "Title for the disclaimer" },
    { name: "disclaimerText", type: "string", initialValue: "", description: "Full text for the disclaimer popup" }
  ],
  editableCSS: [
    { selector: styles.container, properties: ["background"] },
    { selector: styles.wrapper, properties: ["background"] },
    { selector: styles.ctaBox, properties: ["background"] },
    { selector: styles.ctaImageContainer, properties: ["background"] },
    { selector: styles.ctaContent, properties: ["color", "font-size"] },
    { selector: styles.title, properties: ["font-size"] },
    { selector: styles.length, properties: ["font-size"] },
    { selector: styles.videoWrapper, properties: ["box-shadow", "border-radius"] },
    { selector: styles.unmuteTextContainer, properties: ["background", "border-radius", "padding"] },
    { selector: styles.unmuteText, properties: ["color", "font-size"] },
    { selector: styles.logo, properties: ["height"] },
    { selector: styles.ctaImageContainer, properties: ["padding"] },
    { selector: styles.ctaImage, properties: ["height"] },
    { selector: styles.disclaimerButton, properties: ["background", "border-radius", "padding"] },
    { selector: styles.disclaimerHeading, properties: ["color", "font-size"] },
    { selector: styles.disclaimerContent, properties: ["background", "border-radius", "padding"] },
    { selector: styles.disclaimerBody, properties: ["color", "font-size"] }

  ],
  type: "both",
});

export default ContentStoriesV3;