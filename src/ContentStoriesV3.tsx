import React, { useState, useEffect, useRef } from "react";
import { registerVevComponent, useEditorState } from "@vev/react";
import { Volume2, VolumeOff, Pause } from 'lucide-react';
import { Helmet } from 'react-helmet';
import styles from './ContentStoriesV3.module.css';

declare global {
  interface Window {
    jwplayer: any;
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
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTimes, setCurrentTimes] = useState<{ [key: string]: number }>({});
  const [durations, setDurations] = useState<{ [key: string]: number }>({});
  const [seekPercentages, setSeekPercentages] = useState<{ [key: string]: number }>({});
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showTitles, setShowTitles] = useState<{ [key: string]: boolean }>({});
  const [showCtaElements, setShowCtaElements] = useState<{ [key: string]: boolean }>({});
  const [jwPlayerLoaded, setJwPlayerLoaded] = useState(false);
  const [initializedPlayers, setInitializedPlayers] = useState<Set<string>>(new Set());
  const [pausedPlayers, setPausedPlayers] = useState<Set<string>>(new Set());
  const [titles, setTitles] = useState<{ [key: string]: string }>({});
  const [safeAreaInsets, setSafeAreaInsets] = useState({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  });

  // OPTIMIZATION 5: Use refs for performance-critical values that don't need to trigger re-renders
  const playerStatesRef = useRef<{
    currentTimes: { [key: string]: number };
    durations: { [key: string]: number };
    seekPercentages: { [key: string]: number };
  }>({
    currentTimes: {},
    durations: {},
    seekPercentages: {}
  });

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef<boolean>(true);
  // Track pending fetch/init operations
  const pendingOperationsRef = useRef<{ [key: string]: boolean }>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const observerRef = useRef<IntersectionObserver | null>(null);
  const playerInstancesRef = useRef<{ [key: string]: any }>({});
  const { disabled } = useEditorState();

  // OPTIMIZATION 2: Network Resilience - Fetch with retry
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

        // Don't wait on the last attempt
        if (i < retries - 1) {
          // Wait with exponential backoff
          await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
        }
      }
    }

    throw lastError;
  };

  // OPTIMIZATION 1: Resource Management - Limit active players
  const limitActivePlayers = (currentIndex: number) => {
    if (currentIndex === null || mediaIds.length === 0) return;

    // Only keep at most 3 players initialized at any time (current, previous, next)
    const indicesToKeep = [
      currentIndex - 1,
      currentIndex,
      currentIndex + 1
    ].filter(idx => idx >= 0 && idx < mediaIds.length);

    // Get media IDs to keep
    const mediaIdsToKeep = indicesToKeep.map(idx => mediaIds[idx]);

    // Remove players that aren't needed
    Array.from(initializedPlayers).forEach(id => {
      if (!mediaIdsToKeep.includes(id)) {
        try {
          const player = window.jwplayer(`jwplayer-${id}`);
          if (player) {
            player.remove();
            delete playerInstancesRef.current[id];
          }

          // Remove from initialized set
          setInitializedPlayers(prev => {
            const newSet = new Set([...prev]);
            newSet.delete(id);
            return newSet;
          });

          // Clear any paused state
          setPausedPlayers(prev => {
            const newSet = new Set([...prev]);
            newSet.delete(id);
            return newSet;
          });
        } catch (e) {
          console.error(`Error cleaning up player ${id}:`, e);
        }
      }
    });
  };

  // OPTIMIZATION 3: Batch UI state updates
  const updateVideoUIState = (mediaId: string, position: number, duration: number, isActiveVideo: boolean) => {
    const percentage = (position / duration) * 100;

    // Always update the ref
    playerStatesRef.current.currentTimes[mediaId] = position;
    playerStatesRef.current.durations[mediaId] = duration;
    playerStatesRef.current.seekPercentages[mediaId] = percentage;

    // ALWAYS update time and seek states for all videos
    setCurrentTimes(prev => ({ ...prev, [mediaId]: position }));
    setDurations(prev => ({ ...prev, [mediaId]: duration }));
    setSeekPercentages(prev => ({ ...prev, [mediaId]: percentage }));

    // Only update title/CTA visibility states if values changed
    const shouldShowTitle = titleDisplayTime > 0 && position <= titleDisplayTime;
    const shouldShowCta = ctaDisplayTime > 0 && position >= ctaDisplayTime;

    if (showTitles[mediaId] !== shouldShowTitle) {
      setShowTitles(prev => ({ ...prev, [mediaId]: shouldShowTitle }));
    }
    1
    if (showCtaElements[mediaId] !== shouldShowCta) {
      setShowCtaElements(prev => ({ ...prev, [mediaId]: shouldShowCta }));
    }
  };

  // Debug log for props and URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const queryMediaId = urlParams.get('mediaid');

    console.log("Component initialized with:", {
      props: {
        titleDisplayTime,
        ctaDisplayTime,
        inputCtaTekst,
        initialMediaId,
        initialPlaylistId
      },
      urlParams: {
        mediaid: queryMediaId
      }
    });

    // Set mounted ref
    isMountedRef.current = true;

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;

      // Clear all player instances
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
  }, [titleDisplayTime, ctaDisplayTime, inputCtaTekst, initialMediaId, initialPlaylistId]);

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
      // Cleanup script if it hasn't loaded yet
      const existingScript = document.querySelector(`script[src="${script.src}"]`);
      if (existingScript && existingScript.parentNode) {
        existingScript.parentNode.removeChild(existingScript);
      }
    };
  }, []);

  // Check device type and detect safe areas for notches/dynamic islands
  useEffect(() => {
    const handleResize = () => {
      if (!isMountedRef.current) return;

      setIsMobile(window.innerWidth <= 768);

      // Get safe area insets if available in browser
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

    // Set safe area CSS variables for iOS devices
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

  // Fetch playlist data and setup media IDs
  useEffect(() => {
    const fetchPlaylist = async () => {
      if (!initialPlaylistId) {
        if (initialMediaId) setMediaIds([initialMediaId]);
        return;
      }

      try {
        // Use fetchWithRetry for better network resilience
        const data = await fetchWithRetry(`https://cdn.jwplayer.com/v2/playlists/${initialPlaylistId}`);

        if (!isMountedRef.current) return;

        let orderedPlaylist = [...data.playlist];

        // Get mediaId from URL query parameter if it exists
        const urlParams = new URLSearchParams(window.location.search);
        const queryMediaId = urlParams.get('mediaid');

        // Determine which mediaId to prioritize (URL param takes precedence over prop)
        const priorityMediaId = queryMediaId || initialMediaId;

        // Reorder playlist if a priority mediaId is specified
        if (priorityMediaId) {
          console.log(`Prioritizing media ID from ${queryMediaId ? 'URL' : 'props'}: ${priorityMediaId}`);
          const initialIndex = orderedPlaylist.findIndex((item: any) => item.mediaid === priorityMediaId);
          if (initialIndex > -1) {
            const [initialItem] = orderedPlaylist.splice(initialIndex, 1);
            orderedPlaylist = [initialItem, ...orderedPlaylist];
          } else {
            console.warn(`Media ID ${priorityMediaId} not found in playlist`);
          }
        }

        setMediaIds(orderedPlaylist.map((item: any) => item.mediaid));
      } catch (err) {
        console.error("Error fetching playlist:", err);
      }
    };

    fetchPlaylist();
  }, [initialPlaylistId, initialMediaId]);

  // OPTIMIZATION 7: Memory Management - Clean up resources when activeIndex changes
  useEffect(() => {
    if (activeIndex !== null) {
      // Apply resource limiting strategy
      limitActivePlayers(activeIndex);

      // Clean up UI state for videos far from view
      mediaIds.forEach((id, idx) => {
        if (Math.abs(idx - activeIndex) > 2) {
          // Remove UI state for videos that are far from view (outside prev/curr/next)
          setShowTitles(prev => {
            const newState = { ...prev };
            delete newState[id];
            return newState;
          });

          setShowCtaElements(prev => {
            const newState = { ...prev };
            delete newState[id];
            return newState;
          });
        }
      });
    }
  }, [activeIndex, mediaIds]);

  // Initialize and setup intersection observer
  useEffect(() => {
    if (!jwPlayerLoaded || mediaIds.length === 0) return;

    // Setup intersection observer
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const mediaId = entry.target.getAttribute('data-mediaid') || '';
          const index = parseInt(entry.target.getAttribute('data-index') || '0');

          if (entry.isIntersecting && entry.intersectionRatio >= 0.8) {
            const isNewActiveVideo = activeIndex !== index;

            // Set as active video
            setActiveIndex(index);

            // OPTIMIZATION 6: Progressive Enhancement - Prioritize loading current video
            if (isNewActiveVideo) {
              // Immediately pause and possibly unload other videos to prioritize current one
              mediaIds.forEach(id => {
                if (id !== mediaId && initializedPlayers.has(id)) {
                  const player = window.jwplayer(`jwplayer-${id}`);
                  if (player) {
                    player.pause();

                    // If the video is far away, consider unloading it completely
                    const videoIndex = mediaIds.indexOf(id);
                    if (Math.abs(videoIndex - index) > 1) {
                      player.unload();
                    }
                  }
                }
              });
            }

            // Initialize this player if not already initialized
            if (!initializedPlayers.has(mediaId)) {
              initializePlayer(mediaId, index);
            } else {
              const player = window.jwplayer(`jwplayer-${mediaId}`);
              if (player) {
                // If this is a new video coming into view (not the same one that was already active)
                if (isNewActiveVideo) {
                  // Always seek to 0 and play when a new video comes into view
                  player.seek(0);
                  player.play();

                  // Reset title and CTA states for this video
                  setShowTitles(prev => ({ ...prev, [mediaId]: true }));
                  setShowCtaElements(prev => ({ ...prev, [mediaId]: false }));

                  // Clear this video's paused state if it was previously paused
                  setPausedPlayers(prev => {
                    const newSet = new Set([...prev]);
                    newSet.delete(mediaId);
                    return newSet;
                  });
                } else {
                  // This is the same video that was already active
                  // If it's paused, keep it paused at its current position
                  if (!pausedPlayers.has(mediaId)) {
                    player.play();
                  }
                }

                // Always apply the current global mute state
                player.setMute(isMuted);
              }
            }

            // OPTIMIZATION 1: Apply resource limiting after changing active video
            limitActivePlayers(index);
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
  }, [jwPlayerLoaded, mediaIds, initializedPlayers, pausedPlayers, activeIndex, isMuted]);

  // Initialize a player
  const initializePlayer = async (mediaId: string, index: number) => {
    if (!jwPlayerLoaded || initializedPlayers.has(mediaId) || pendingOperationsRef.current[mediaId]) return;

    // Mark this mediaId as having a pending operation
    pendingOperationsRef.current[mediaId] = true;

    try {
      // OPTIMIZATION 2: Fetch media data with retry for better network resilience
      const data = await fetchWithRetry(`https://cdn.jwplayer.com/v2/media/${mediaId}`);

      if (!isMountedRef.current) return;

      const videoItem = data.playlist[0];

      // Store title
      setTitles(prev => ({ ...prev, [mediaId]: videoItem.title }));

      // Initialize title visibility (always show at start)
      setShowTitles(prev => ({ ...prev, [mediaId]: true }));

      // Initialize CTA visibility (hide at start)
      setShowCtaElements(prev => ({ ...prev, [mediaId]: false }));

      // Initialize JW Player
      const player = window.jwplayer(`jwplayer-${mediaId}`);
      // Store player instance in ref for later access
      playerInstancesRef.current[mediaId] = player;
      player.setup({
        playlist: [{
          mediaid: mediaId,
          title: videoItem.title,
          // Don't use the image to avoid the thumbnail flash
          // image: videoItem.image,
          sources: videoItem.sources,
          tracks: videoItem.tracks || []
        }],
        mute: isMuted,
        autostart: true,
        controls: false,
        width: '100%',
        height: '100%',
        preload: 'auto',
        androidhls: true,
        backgroundcolor: '#000000',
        stretching: 'fill', // Force fill - will crop as needed
        aspectratio: false // Disable aspect ratio constraint
      });

      // OPTIMIZATION 4: Better Error Handling - Add error recovery
      player.on('error', (e: any) => {
        console.error(`Player error for ${mediaId}:`, e);

        if (!isMountedRef.current) return;

        // Try to recover by re-initializing after a short delay
        setTimeout(() => {
          try {
            if (index === activeIndex) {
              // If this is the active player, try to recover
              player.setup({
                playlist: [{
                  mediaid: mediaId,
                  title: videoItem.title,
                  sources: videoItem.sources,
                  tracks: videoItem.tracks || []
                }],
                mute: isMuted,
                autostart: true,
                controls: false,
                width: '100%',
                height: '100%',
                preload: 'auto',
                androidhls: true,
                backgroundcolor: '#000000',
                stretching: 'fill',
                aspectratio: false
              });

              // Force load and play
              player.load();
              if (!pausedPlayers.has(mediaId)) {
                player.play();
              }
            }
          } catch (recoverError) {
            console.error(`Recovery failed for ${mediaId}:`, recoverError);
          }
        }, 1000);
      });

      // Set up optimized event listeners
      player.on('time', (e: any) => {
        if (!isMountedRef.current) return;

        // OPTIMIZATION 3: Use the batched update function
        updateVideoUIState(mediaId, e.position, e.duration, index === activeIndex);
      });

      player.on('complete', () => {
        if (!isMountedRef.current) return;

        // Auto-play next video
        if (index < mediaIds.length - 1) {
          const nextVideoEl = videoRefs.current[mediaIds[index + 1]];
          nextVideoEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });

      // Add a buffer event listener to know when the video is actually ready to play
      player.on('buffer', (e: any) => {
        if (!isMountedRef.current) return;

        // If buffer is full enough (>= 5%), we can consider it ready to play
        // Using a lower threshold for faster startup
        if (e.bufferPercent >= 5 && index === activeIndex && !pausedPlayers.has(mediaId)) {
          player.play();
        }
      });

      player.on('ready', () => {
        if (!isMountedRef.current) return;

        // Mark as initialized
        setInitializedPlayers(prev => new Set([...prev, mediaId]));

        // If this is the active video, start buffering it
        // We'll play it once buffer event fires with enough data
        if (index === activeIndex && !pausedPlayers.has(mediaId)) {
          // Start loading the video data
          player.load();
          player.setMute(isMuted);
        }
      });

    } catch (error) {
      console.error(`Error initializing player for ${mediaId}:`, error);
    } finally {
      // Clear the pending operation flag
      delete pendingOperationsRef.current[mediaId];
    }
  };

  // Handle video click
  const handleVideoClick = (mediaId: string) => {
    if (!initializedPlayers.has(mediaId)) return;

    const player = window.jwplayer(`jwplayer-${mediaId}`);
    if (player) {
      if (player.getState() === 'playing') {
        player.pause();
        setPausedPlayers(prev => new Set([...prev, mediaId]));
      } else {
        player.play();
        setPausedPlayers(prev => {
          const newSet = new Set([...prev]);
          newSet.delete(mediaId);
          return newSet;
        });
      }
    }
  };

  // Handle mute toggle
  const handleMute = () => {
    const newMuteState = !isMuted;
    setIsMuted(newMuteState);

    // Apply to all initialized players
    mediaIds.forEach(mediaId => {
      if (initializedPlayers.has(mediaId)) {
        const player = window.jwplayer(`jwplayer-${mediaId}`);
        if (player) {
          player.setMute(newMuteState);
        }
      }
    });
  };

  // Handle seek bar click
  const handleSeek = (e: React.MouseEvent, mediaId: string) => {
    if (!initializedPlayers.has(mediaId)) return;

    const player = window.jwplayer(`jwplayer-${mediaId}`);
    if (player) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const percentage = (e.clientX - rect.left) / rect.width;
      player.seek(percentage * player.getDuration());
    }
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

                {/* Loading indicator - show while loading or buffering */}
                {(!initializedPlayers.has(mediaId) ||
                  (index === activeIndex &&
                    initializedPlayers.has(mediaId) &&
                    playerInstancesRef.current[mediaId]?.getState() === 'buffering')) && (
                    <div className={styles.loadingIndicator}></div>
                  )}

                {/* Pause indicator */}
                {pausedPlayers.has(mediaId) && initializedPlayers.has(mediaId) && (
                  <div className={styles.pauseIndicator}>
                    <Pause size={48} color="white" />
                  </div>
                )}

                {/* Video overlay - show for all videos */}
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
                    {/* Only show title if showTitles[mediaId] is true */}
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

                {/* Seek bar - show for all videos */}
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
            {isMuted ? <VolumeOff size={24} /> : <Volume2 size={24} />}
          </div>
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
    { selector: styles.videoWrapper, properties: ["box-shadow", "border-radius"] }
  ],
  type: "both",
});

export default ContentStoriesV3;