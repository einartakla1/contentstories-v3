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
  // Track title visibility per video
  const [showTitles, setShowTitles] = useState<{ [key: string]: boolean }>({});
  // Track CTA visibility per video
  const [showCtaElements, setShowCtaElements] = useState<{ [key: string]: boolean }>({});
  const [jwPlayerLoaded, setJwPlayerLoaded] = useState(false);
  const [initializedPlayers, setInitializedPlayers] = useState<Set<string>>(new Set());
  const [pausedPlayers, setPausedPlayers] = useState<Set<string>>(new Set());
  const [titles, setTitles] = useState<{ [key: string]: string }>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const observerRef = useRef<IntersectionObserver | null>(null);
  const playerInstancesRef = useRef<{ [key: string]: any }>({});
  const { disabled } = useEditorState();

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
    script.onload = () => setJwPlayerLoaded(true);
    document.body.appendChild(script);

    return () => {
      // Cleanup players when component unmounts
      Object.keys(playerInstancesRef.current).forEach(mediaId => {
        try {
          if (playerInstancesRef.current[mediaId]) {
            window.jwplayer(`jwplayer-${mediaId}`).remove();
            delete playerInstancesRef.current[mediaId];
          }
        } catch (e) {
          console.error(`Error removing player ${mediaId}:`, e);
        }
      });
    };
  }, [mediaIds, initializedPlayers]);

  // Check device type
  useEffect(() => {
    setIsMobile(window.innerWidth <= 768);
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
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
        const response = await fetch(`https://cdn.jwplayer.com/v2/playlists/${initialPlaylistId}`);
        const data = await response.json();
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

            // Pause all other videos
            mediaIds.forEach(id => {
              if (id !== mediaId && initializedPlayers.has(id)) {
                const player = window.jwplayer(`jwplayer-${id}`);
                if (player) {
                  player.pause();
                }
              }
            });
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
  }, [jwPlayerLoaded, mediaIds, initializedPlayers, pausedPlayers, activeIndex]);

  // Initialize a player
  const initializePlayer = async (mediaId: string, index: number) => {
    if (!jwPlayerLoaded || initializedPlayers.has(mediaId)) return;

    try {
      // Fetch media data
      const response = await fetch(`https://cdn.jwplayer.com/v2/media/${mediaId}`);
      const data = await response.json();
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
        autostart: false,
        controls: false,
        width: '100%',
        height: '100%',
        preload: 'auto',
        androidhls: true,
        // Add a black background to avoid seeing the thumbnail
        backgroundcolor: '#000000'
      });

      // Set up event listeners
      player.on('time', (e: any) => {
        const percentage = (e.position / e.duration) * 100;
        setSeekPercentages(prev => ({ ...prev, [mediaId]: percentage }));
        setCurrentTimes(prev => ({ ...prev, [mediaId]: e.position }));
        setDurations(prev => ({ ...prev, [mediaId]: e.duration }));

        // Update title and CTA visibility based on current position
        const shouldShowTitle = titleDisplayTime > 0 && e.position <= titleDisplayTime;
        const shouldShowCta = ctaDisplayTime > 0 && e.position >= ctaDisplayTime;


        // Update per-video state
        setShowTitles(prev => ({ ...prev, [mediaId]: shouldShowTitle }));
        setShowCtaElements(prev => ({ ...prev, [mediaId]: shouldShowCta }));
      });

      player.on('complete', () => {
        // Auto-play next video
        if (index < mediaIds.length - 1) {
          const nextVideoEl = videoRefs.current[mediaIds[index + 1]];
          nextVideoEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });

      // Add a buffer event listener to know when the video is actually ready to play
      player.on('buffer', (e: any) => {
        // If buffer is full enough (>= 5%), we can consider it ready to play
        // Using a lower threshold for faster startup
        if (e.bufferPercent >= 5 && index === activeIndex && !pausedPlayers.has(mediaId)) {
          player.play();
        }
      });

      player.on('ready', () => {
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