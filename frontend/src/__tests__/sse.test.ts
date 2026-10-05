import { describe, it, expect } from "vitest";
import { parseSSEChunk } from "../lib/api";

describe("SSE Stream Parser", () => {
  it("parses single complete SSE event", () => {
    const raw = "event: token\ndata: {\"text\":\"Hola\"}\n\n";
    const res = parseSSEChunk("", raw);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].event).toBe("token");
    expect(res.events[0].data).toBe('{"text":"Hola"}');
    expect(res.remaining).toBe("");
  });

  it("handles events split across chunks", () => {
    // Chunk 1 has partial event
    const chunk1 = "event: token\ndata: {\"text\":\"";
    const res1 = parseSSEChunk("", chunk1);
    expect(res1.events).toHaveLength(0);
    expect(res1.remaining).toBe('event: token\ndata: {"text":"');

    // Chunk 2 completes the event and starts another
    const chunk2 = 'Hola mundo"}\n\nevent: done\ndata: {"sources":[]}\n\n';
    const res2 = parseSSEChunk(res1.remaining, chunk2);
    expect(res2.events).toHaveLength(2);
    expect(res2.events[0].event).toBe("token");
    expect(res2.events[0].data).toBe('{"text":"Hola mundo"}');
    expect(res2.events[1].event).toBe("done");
    expect(res2.events[1].data).toBe('{"sources":[]}');
    expect(res2.remaining).toBe("");
  });

  it("handles Windows CRLF line endings", () => {
    const raw = "event: plan\r\ndata: {\"intent\":\"analisis\"}\r\n\r\n";
    const res = parseSSEChunk("", raw);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].event).toBe("plan");
    expect(res.events[0].data).toBe('{"intent":"analisis"}');
  });

  it("ignores SSE comment lines", () => {
    const raw = ": this is a ping\nevent: token\ndata: {\"text\":\"ok\"}\n\n";
    const res = parseSSEChunk("", raw);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].event).toBe("token");
    expect(res.events[0].data).toBe('{"text":"ok"}');
  });

  it("parses multi-line data payloads", () => {
    const raw = "event: data\ndata: line1\ndata: line2\n\n";
    const res = parseSSEChunk("", raw);
    expect(res.events).toHaveLength(1);
    expect(res.events[0].event).toBe("data");
    expect(res.events[0].data).toBe("line1\nline2");
  });
});
