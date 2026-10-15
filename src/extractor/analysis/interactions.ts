/**
 * Pairs tool_call events with their tool_result events by callId.
 */
import type { CallLog, ToolCallEvent, ToolResultEvent } from "../../shared/types.js";

export interface ToolInteraction {
  callId: string;
  toolName: string;
  callIndex: number;
  call: ToolCallEvent;
  resultIndex: number | null;
  result: ToolResultEvent | null;
}

export function pairInteractions(log: CallLog): ToolInteraction[] {
  const byId = new Map<string, ToolInteraction>();
  const ordered: ToolInteraction[] = [];
  log.events.forEach((event, index) => {
    if (event.type === "tool_call") {
      const interaction: ToolInteraction = {
        callId: event.callId,
        toolName: event.toolName,
        callIndex: index,
        call: event,
        resultIndex: null,
        result: null,
      };
      byId.set(event.callId, interaction);
      ordered.push(interaction);
    } else if (event.type === "tool_result") {
      const interaction = byId.get(event.callId);
      if (interaction && interaction.result === null) {
        interaction.result = event;
        interaction.resultIndex = index;
      }
    }
  });
  return ordered;
}
