"use client";

import { useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  SimplifiedSection as SimplifiedSectionType,
  GeneratedImage,
  GeneratedCanvas,
  VideoJob,
  GeneratedLab,
  WebSearchResult,
} from "@/lib/types";
import SimplifiedSection from "./SimplifiedSection";
import ImageBlock from "./ImageBlock";
import CanvasBlock from "./CanvasBlock";
import VideoBlock from "./VideoBlock";
import LabsBlock from "./LabsBlock";
import ResearchBlock from "./ResearchBlock";
import ChatPanel from "@/components/chat/ChatPanel";
import {
  generateManualImage,
  generateManualCanvas,
  generateManualVideo,
  regenerateImage,
} from "@/lib/api";

interface Props {
  paperId: string;
  sessionId: string;
  sections: SimplifiedSectionType[];
  images: GeneratedImage[];
  canvases: GeneratedCanvas[];
  videos: VideoJob[];
  labs: GeneratedLab[];
  webSearchResults: WebSearchResult[];
  onNewImage: (img: GeneratedImage) => void;
  onNewCanvas: (c: GeneratedCanvas) => void;
  onNewVideo: (v: VideoJob) => void;
  onVideoUpdate: (v: VideoJob) => void;
}

const sectionVariants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export default function OutputTimeline({
  paperId,
  sessionId,
  sections,
  images,
  canvases,
  videos,
  labs,
  webSearchResults,
  onNewImage,
  onNewCanvas,
  onNewVideo,
  onVideoUpdate,
}: Props) {
  const handleRequestImage = useCallback(
    async (concept: string, sectionText: string) => {
      try {
        const img = await generateManualImage(
          paperId,
          concept,
          sectionText.slice(0, 2000),
        );
        onNewImage(img);
      } catch (err) {
        console.error("Image generation failed:", err);
      }
    },
    [paperId, onNewImage],
  );

  const handleRequestCanvas = useCallback(
    async (concept: string, sectionIndex: number) => {
      try {
        const canvas = await generateManualCanvas(
          paperId,
          sectionIndex,
          concept,
        );
        onNewCanvas(canvas);
      } catch (err) {
        console.error("Canvas generation failed:", err);
      }
    },
    [paperId, onNewCanvas],
  );

  const handleRequestVideo = useCallback(
    async (concept: string) => {
      try {
        const job = await generateManualVideo(paperId, concept);
        onNewVideo(job);
      } catch (err) {
        console.error("Video generation failed:", err);
      }
    },
    [paperId, onNewVideo],
  );

  const handleRegenerate = useCallback(
    async (concept: string) => {
      try {
        const img = await regenerateImage(paperId, concept);
        onNewImage(img);
      } catch (err) {
        console.error("Image regeneration failed:", err);
      }
    },
    [paperId, onNewImage],
  );

  const getMediaForSection = (section: SimplifiedSectionType) => {
    const mediaPlan = section.media_plan ?? {};
    const concepts = Object.keys(mediaPlan);

    const sectionImages = images.filter((img) =>
      concepts.includes(img.concept),
    );
    const sectionCanvases = canvases.filter(
      (c) => c.section_index === section.section_index,
    );
    const sectionVideos = videos.filter((v) =>
      concepts.includes(v.concept),
    );

    return { sectionImages, sectionCanvases, sectionVideos };
  };

  return (
    <div className="space-y-6">
      {/* Sections with media — wrapped in AnimatePresence for streaming animations */}
      <AnimatePresence mode="popLayout">
        {sections.map((section) => {
          const { sectionImages, sectionCanvases, sectionVideos } =
            getMediaForSection(section);

          return (
            <motion.div
              key={section.id}
              variants={sectionVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="space-y-4"
            >
              <SimplifiedSection
                section={section}
                paperId={paperId}
                onRequestImage={(concept) =>
                  handleRequestImage(concept, section.simplified_text)
                }
                onRequestCanvas={(concept) =>
                  handleRequestCanvas(concept, section.section_index)
                }
                onRequestVideo={handleRequestVideo}
              />

              {/* Media blocks for this section */}
              <AnimatePresence>
                {sectionImages.map((img) => (
                  <motion.div
                    key={img.id}
                    variants={sectionVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={{ duration: 0.25, ease: "easeOut" }}
                  >
                    <ImageBlock image={img} onRegenerate={handleRegenerate} />
                  </motion.div>
                ))}

                {sectionCanvases.map((canvas) => (
                  <motion.div
                    key={canvas.id}
                    variants={sectionVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={{ duration: 0.25, ease: "easeOut" }}
                  >
                    <CanvasBlock canvas={canvas} />
                  </motion.div>
                ))}

                {sectionVideos.map((video) => (
                  <motion.div
                    key={video.id}
                    variants={sectionVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={{ duration: 0.25, ease: "easeOut" }}
                  >
                    <VideoBlock video={video} onStatusChange={onVideoUpdate} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Research */}
      <ResearchBlock results={webSearchResults} />

      {/* Labs */}
      <LabsBlock labs={labs} paperId={paperId} />

      {/* Chat */}
      <ChatPanel paperId={paperId} sessionId={sessionId} />
    </div>
  );
}
