#!/bin/bash
echo ready
i=0
hooks=(
  '{"hook_event_name":"SessionStart","session_id":"00000000-0000-4000-8000-000000000001"}'
  '{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"allow?"}'
  '{"hook_event_name":"UserPromptSubmit"}'
  '{"hook_event_name":"Stop"}'
  '{"hook_event_name":"Notification","notification_type":"idle_prompt"}'
)
while IFS= read -r _; do
  body="${hooks[$i]}"
  i=$((i + 1))
  curl -s -m 1 -X POST -H "x-turnflow-token: $TURNFLOW_SESSION_TOKEN" --data-binary "$body" "http://127.0.0.1:$TURNFLOW_HOOK_PORT/hook" || true
done
