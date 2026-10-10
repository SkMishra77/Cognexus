"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { FlaskConical, Download, Archive } from "lucide-react";
import type { GeneratedLab } from "@/lib/types";
import { downloadLab, downloadLabsZip } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";

interface Props {
  labs: GeneratedLab[];
  paperId: string;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

export default function LabsBlock({ labs, paperId }: Props) {
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleDownloadAll = useCallback(async () => {
    setDownloadingAll(true);
    try {
      const blob = await downloadLabsZip(paperId);
      triggerBlobDownload(blob, "labs.zip");
      toast("All labs downloaded successfully", "success");
    } catch {
      toast("Failed to download labs", "error");
    } finally {
      setDownloadingAll(false);
    }
  }, [paperId, toast]);

  const handleDownloadSingle = useCallback(
    async (lab: GeneratedLab) => {
      setDownloadingId(lab.id);
      try {
        const blob = await downloadLab(paperId, lab.id);
        triggerBlobDownload(blob, `${lab.title.replace(/\s+/g, "_")}.ipynb`);
        toast("Lab downloaded successfully", "success");
      } catch {
        toast("Failed to download lab", "error");
      } finally {
        setDownloadingId(null);
      }
    },
    [paperId, toast]
  );

  if (labs.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-900/40">
            <FlaskConical className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-zinc-100">
              {labs.length} Experiment Lab{labs.length !== 1 ? "s" : ""} Ready
            </h2>
            <p className="text-xs text-zinc-500">Interactive Jupyter notebooks</p>
          </div>
        </div>
        <Button
          onClick={handleDownloadAll}
          loading={downloadingAll}
          iconLeft={!downloadingAll ? <Archive size={16} /> : undefined}
          className="bg-emerald-600 text-white hover:bg-emerald-500 focus-visible:ring-emerald-500"
        >
          Download All as ZIP
        </Button>
      </div>

      {/* Lab Cards */}
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        initial="hidden"
        animate="visible"
        variants={containerVariants}
      >
        {labs.map((lab) => (
          <motion.div
            key={lab.id}
            variants={cardVariants}
            whileHover={{ scale: 1.01 }}
            className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 flex items-start justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-zinc-200 text-sm truncate">
                {lab.title}
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                {lab.concept}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleDownloadSingle(lab)}
              loading={downloadingId === lab.id}
              iconLeft={downloadingId !== lab.id ? <Download size={12} /> : undefined}
            >
              .ipynb
            </Button>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
