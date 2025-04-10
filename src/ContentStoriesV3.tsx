import React, { useState, useEffect, useRef } from "react";
import { registerVevComponent, useEditorState } from "@vev/react";

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
};

const formatTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

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
  ctaDisplayTime
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

  const { disabled } = useEditorState();

  // Simple fetch with retry function
  const fetchWithRetry = async (url: string, retries = 3, delay = 300): Promise<any> => {
    let lastError;

    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        return await response.json();
      } catch (error) {
        console.warn(`Fetch attempt ${i + 1} failed for ${url}`, error);
        lastError = error;

        if (i < retries - 1) {
          await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
        }
      }
    }

    throw lastError;
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
    setIsInDNApp(userAgentString.includes("DNApp"));

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
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
        });
      },
      { threshold: [0.8] }
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

    console.log(`Initializing player for ${mediaId} (muted: ${isMuted}, preloadOnly: ${preloadOnly})`);
    pendingOperationsRef.current[mediaId] = true;

    try {
      const data = await fetchWithRetry(`https://cdn.jwplayer.com/v2/media/${mediaId}`);
      if (!isMountedRef.current) return;

      const videoItem = data.playlist[0];

      setTitles(prev => ({ ...prev, [mediaId]: videoItem.title }));
      setShowTitles(prev => ({ ...prev, [mediaId]: true }));
      setShowCtaElements(prev => ({ ...prev, [mediaId]: false }));

      // Initialize JW Player
      const player = window.jwplayer(`jwplayer-${mediaId}`);
      playerInstancesRef.current[mediaId] = player;

      // Always start muted on mobile regardless of state
      // We'll unmute later if needed
      const startMuted = true; // Always start muted, we'll unmute after playing starts if needed

      player.setup({
        playlist: [{
          mediaid: mediaId,
          title: videoItem.title,
          sources: videoItem.sources,
          tracks: videoItem.tracks || []
        }],
        mute: startMuted,
        autostart: index === 0, // Do not autostart on setup
        controls: false,
        width: '100%',
        height: '100%',
        preload: 'auto',
        androidhls: true,
        backgroundcolor: '#000000',
        stretching: 'fill',
        aspectratio: false,
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
      });


      player.on('play', () => {
        // If this is the first video and it's now playing, mark it as triggered
        if (index === 0) {
          console.log("First video now playing, marking autoplay as successful");
          hasTriggeredInitialPlayRef.current = true;
          setActiveIndex(0);
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
              stretching: 'fill'
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
        // Ensure correct mute state based on global and unmuted reference
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

  return (
    <>
      <Helmet>
        <link rel="stylesheet" href="https://static1.dn.no/dn/static/assets/css/nhstfonts.css" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
      </Helmet>

      <div
        className={styles.container}
        style={{
          '--overlay-bottom-offset': isInDNApp ? '110px' : '25px',
          '--controls-bottom-offset': isInDNApp ? '160px' : '30px',
          '--seekbar-bottom-offset': isInDNApp ? '100px' : '15px',
          '--seekbar-width-offset': isInDNApp ? '110px' : '40px',
        } as React.CSSProperties}
      >
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
              className={styles.videoContainer}
              data-index={index}
              data-mediaid={mediaId}
            >
              <div className={styles.videoWrapper}>
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
                    <Pause size={48} color="white" />
                  </div>
                )}

                {/* Video overlay */}
                <div className={`${styles.videoOverlay} ${index === activeIndex ? styles.activeOverlay : styles.inactiveOverlay}`}>
                  <div className={styles.titleContainer}>
                    {inputCtaTekst && inputCtaTekst !== 'none' && showCtaElements[mediaId] && (
                      inputCtaLink ? (
                        <a href={inputCtaLink} target="_parent" className={styles.ctaBox}>
                          {inputCtaImage?.url && (
                            <div className={styles.ctaImageContainer}>
                              <img src={inputCtaImage.url} className={styles.ctaImage} alt="CTA" />
                            </div>
                          )}
                          <div className={styles.ctaContent}>
                            {inputCtaTekst}
                          </div>
                        </a>
                      ) : (
                        <div className={styles.ctaBox}>
                          <div className={styles.ctaContent}>
                            {inputCtaTekst}
                          </div>
                        </div>
                      )
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
                  className={`${styles.seekBarContainer} ${index === activeIndex ? styles.activeSeekBar : styles.inactiveSeekBar}`}
                >
                  <div
                    className={styles.seekBarProgress}
                    style={{ width: `${seekPercentages[mediaId] || 0}%` }}
                  />
                </div>

                {/* Larger clickable area for seek bar */}
                <div
                  className={styles.seekBarClickArea}
                  onClick={(e) => handleSeek(e, mediaId)}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className={styles.controls}>
          <div className={styles.controlButton} onClick={handleMute}>
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
    { name: "ctaDisplayTime", type: "number", initialValue: 5 }
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
  ],
  type: "both",
});

export default ContentStoriesV3;