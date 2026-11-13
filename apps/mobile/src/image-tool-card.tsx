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
});

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
}: {
  kind: "image" | "video";
  idea?: unknown;
  result: unknown;
  loading: boolean;
}) {
  const { api } = useWorkspace();
  const value = parse(result);
  const hidden = kind === "image" && value.passed === false;
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!value.id || hidden) return;
    let cancelled = false;
    api
      .request<{ url: string }>(`/api/images/${encodeURIComponent(value.id)}`)
      .then((media) => !cancelled && setUrl(media.url))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [api, value.id, hidden]);
  const Icon = kind === "video" ? Film : ImageIcon;
  const noun = kind === "video" ? "Video" : "Image";
  const title = loading
    ? `Creating ${noun.toLowerCase()}…`
    : value.error
      ? `${noun} failed`
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
        {loading && <ActivityIndicator />}
      </View>
      {typeof idea === "string" && <Text style={s.muted}>{idea}</Text>}
      {loading && (
        <Text style={s.small}>
          {kind === "video"
            ? "This runs on your GPU and takes several minutes."
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
              aspectRatio: "832 / 480",
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
      {!!value.prompt && !hidden && (
        <Text style={s.small} selectable>
          {value.prompt}
          {kind === "image" && typeof value.score === "number" && value.score > 0
            ? ` · score ${value.score}/10`
            : ""}
        </Text>
      )}
      <ErrorNotice error={value.error || error} />
    </Card>
  );
}
