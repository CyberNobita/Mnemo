import { Film, ImageIcon } from "lucide-react-native";
import { createElement, useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, Text, View } from "react-native";
import { z } from "zod";
import { Button, Card, colors, ErrorNotice, s } from "./ui";
import { useWorkspace } from "./workspace";

const resultSchema = z.object({
  id: z.string().optional(),
  prompt: z.string().optional(),
  score: z.number().optional(),
  minScore: z.number().optional(),
  passed: z.boolean().optional(),
  rounds: z.number().optional(),
  error: z.string().optional(),
  status: z.string().optional(),
  scenes: z.number().optional(),
  seconds: z.number().optional(),
});

type Media = {
  url: string;
  prompt?: string;
  status?: "running" | "done" | "failed";
  progress?: { done: number; total: number };
  seconds?: number;
  error?: string;
};
/** How often a long video's card checks for progress. */
const POLL_MS = 15000;

function parse(result: unknown) {
  try {
    return resultSchema.parse(typeof result === "string" ? JSON.parse(result) : result);
  } catch {
    return {};
  }
}

/**
 * Shows a generated picture or video clip. Signed URLs expire, so a fresh one is fetched on
 * render. A picture that did not reach its quality target is not shown.
 */
export function ImageToolCard({
  kind,
  idea,
  result,
  loading,
  editing = false,
}: {
  kind: "image" | "video";
  /** The picture is a change to a photo (edit_image) rather than a new one. */
  editing?: boolean;
  idea?: unknown;
  result: unknown;
  loading: boolean;
}) {
  const { api } = useWorkspace();
  const value = parse(result);
  const hidden = kind === "image" && value.passed === false;
  const [media, setMedia] = useState<Media>();
  const [error, setError] = useState("");
  const url = media?.url ?? "";
  useEffect(() => {
    if (!value.id || hidden) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api
        .request<Media>(`/api/images/${encodeURIComponent(value.id ?? "")}`)
        .then((next) => {
          if (cancelled) return;
          setMedia(next);
          setError("");
          // A long video renders in the background; keep checking until it is ready.
          if (next.status === "running") timer = setTimeout(load, POLL_MS);
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
          if (value.status === "running") timer = setTimeout(load, POLL_MS);
        });
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, value.id, value.status, hidden]);
  const Icon = kind === "video" ? Film : ImageIcon;
  const noun = kind === "video" ? "Video" : "Image";
  const background = media?.status ?? (value.status === "running" ? "running" : undefined);
  const progress = media?.progress ?? (value.scenes ? { done: 0, total: value.scenes } : undefined);
  const title = loading
    ? editing
      ? "Changing the photo…"
      : `Creating ${noun.toLowerCase()}…`
    : value.error || background === "failed"
      ? `${noun} failed`
      : background === "running"
        ? `Creating video… scene ${Math.min((progress?.done ?? 0) + 1, progress?.total ?? 1)} of ${progress?.total ?? "?"}`
        : hidden
          ? "Quality target not reached"
          : noun;
  return (
    <Card style={{ gap: 12, width: "100%", maxWidth: 560 }}>
      <View style={[s.row, { gap: 10 }]}>
        <Icon size={18} color={colors.muted} />
        <Text style={[s.heading, { flex: 1 }]} numberOfLines={2}>
          {title}
        </Text>
        {(loading || background === "running") && <ActivityIndicator />}
      </View>
      {typeof idea === "string" && <Text style={s.muted}>{idea}</Text>}
      {background === "running" && progress && (
        <View style={{ gap: 6 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line }}>
            <View
              style={{
                height: 6,
                borderRadius: 3,
                width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%`,
                backgroundColor: colors.blueDark,
              }}
            />
          </View>
          <Text style={s.small}>
            {progress.done} of {progress.total} scenes done. Each scene takes a few minutes on your
            GPU; you can keep chatting, and the video plays here when it is ready.
          </Text>
        </View>
      )}
      {loading && (
        <Text style={s.small}>
          {kind === "video"
            ? "This runs on your GPU and takes several minutes."
            : editing
              ? "This runs on your GPU and takes one to a few minutes."
              : "This runs on your GPU. Each try takes about 1.5 minutes, and it keeps improving until the quality target is met."}
        </Text>
      )}
      {hidden && (
        <Text style={s.small}>
          Best score was {value.score}/10 after {value.rounds} tries (target {value.minScore}). The
          image was not shown. Ask again to retry.
        </Text>
      )}
      {url && kind === "image" ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)}>
          <Image
            accessibilityLabel={value.prompt || "Generated image"}
            source={{ uri: url }}
            style={{ width: "100%", aspectRatio: 1, borderRadius: 12 }}
            resizeMode="cover"
          />
        </Pressable>
      ) : null}
      {url && kind === "video" ? (
        Platform.OS === "web" ? (
          createElement("video", {
            src: url,
            controls: true,
            loop: true,
            autoPlay: true,
            muted: true,
            playsInline: true,
            style: {
              width: "100%",
              aspectRatio: "16 / 9",
              borderRadius: 12,
              background: "#000",
            },
          })
        ) : (
          <Button small icon={Film} onPress={() => void Linking.openURL(url)}>
            Play video
          </Button>
        )
      ) : null}
      {!!(value.prompt || media?.prompt) && !hidden && (
        <Text style={s.small} selectable>
          {value.prompt || media?.prompt}
          {kind === "image" && typeof value.score === "number" && value.score > 0
            ? ` · score ${value.score}/10`
            : ""}
          {kind === "video" && background === "done" && media?.seconds
            ? ` · ${media.seconds}s`
            : ""}
        </Text>
      )}
      <ErrorNotice error={value.error || media?.error || error} />
    </Card>
  );
}
