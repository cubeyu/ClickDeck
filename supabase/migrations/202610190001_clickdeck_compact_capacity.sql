-- Task 153. Deploy after tasks 144/145. No bulk cleanup: only the submitting
-- member's rows are compacted transactionally; other members remain untouched.
begin;
create or replace function public.submit_clickdeck_tasks(
 requested_project_id uuid, requested_page_fingerprint text, requested_tasks jsonb
) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare
 uid uuid := auth.uid();
 project public.clickdeck_projects%rowtype;
 member public.clickdeck_members%rowtype;
 previous jsonb; combined jsonb; merged jsonb := '[]';
 slots jsonb := '{}'; keys text[] := '{}'; k text; task jsonb; first_task jsonb;
 other_count integer; other_bytes bigint; result_id uuid; old_count integer;
 spec constant jsonb := $schema${
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "maxLength": 200,
      "minLength": 1
    },
    "sequence": {
      "type": "integer",
      "minimum": 0,
      "maximum": 999999999
    },
    "kind": {
      "type": "string",
      "enum": [
        "style",
        "content",
        "attribute",
        "intent",
        "move",
        "remove"
      ],
      "maxLength": 80
    },
    "summary": {
      "type": "string",
      "maxLength": 4000,
      "minLength": 1
    },
    "locator": {
      "type": "object",
      "properties": {
        "descriptor": {
          "type": "string",
          "maxLength": 500
        },
        "tagName": {
          "type": "string",
          "maxLength": 80
        },
        "roleHint": {
          "type": "string",
          "maxLength": 200
        },
        "textSnippet": {
          "type": "string",
          "maxLength": 500
        },
        "imageHint": {
          "type": "string",
          "maxLength": 1000
        },
        "classHint": {
          "type": "string",
          "maxLength": 500
        },
        "idHint": {
          "type": "string",
          "maxLength": 300
        },
        "cssPath": {
          "type": "string",
          "maxLength": 1000,
          "minLength": 1
        },
        "nthOfTypePath": {
          "type": "string",
          "maxLength": 1000
        },
        "siblingIndex": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1000000000
        },
        "parentDescriptor": {
          "type": "string",
          "maxLength": 500
        },
        "semanticRole": {
          "type": "string",
          "maxLength": 200
        },
        "semanticAncestor": {
          "type": "string",
          "maxLength": 500
        },
        "previousSiblingDescriptor": {
          "type": "string",
          "maxLength": 500
        },
        "nextSiblingDescriptor": {
          "type": "string",
          "maxLength": 500
        },
        "selectorStability": {
          "type": "string",
          "enum": [
            "high",
            "medium",
            "low"
          ],
          "maxLength": 80
        },
        "selectorStabilityReason": {
          "type": "string",
          "maxLength": 500
        }
      },
      "required": [
        "tagName",
        "cssPath"
      ],
      "additionalProperties": false
    },
    "before": {
      "type": "string",
      "maxLength": 4000
    },
    "after": {
      "type": "string",
      "maxLength": 4000
    },
    "property": {
      "type": "string",
      "maxLength": 100
    },
    "attribute": {
      "type": "string",
      "enum": [
        "src"
      ],
      "maxLength": 80
    },
    "source": {
      "type": "object",
      "properties": {
        "userIntent": {
          "type": "string",
          "maxLength": 4000
        },
        "pageMode": {
          "type": "string",
          "enum": [
            "slide",
            "long",
            "unknown"
          ],
          "maxLength": 80
        },
        "relativeBox": {
          "type": "object",
          "properties": {
            "left": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            },
            "top": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            },
            "right": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            },
            "bottom": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            },
            "width": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            },
            "height": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            }
          },
          "required": [
            "left",
            "top",
            "right",
            "bottom",
            "width",
            "height"
          ],
          "additionalProperties": false
        },
        "anchor": {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "slide",
                "section",
                "container",
                "document"
              ],
              "maxLength": 80
            },
            "label": {
              "type": "string",
              "maxLength": 300
            },
            "locator": {
              "type": "object",
              "properties": {
                "descriptor": {
                  "type": "string",
                  "maxLength": 500
                },
                "tagName": {
                  "type": "string",
                  "maxLength": 80
                },
                "roleHint": {
                  "type": "string",
                  "maxLength": 200
                },
                "textSnippet": {
                  "type": "string",
                  "maxLength": 500
                },
                "imageHint": {
                  "type": "string",
                  "maxLength": 1000
                },
                "classHint": {
                  "type": "string",
                  "maxLength": 500
                },
                "idHint": {
                  "type": "string",
                  "maxLength": 300
                },
                "cssPath": {
                  "type": "string",
                  "maxLength": 1000,
                  "minLength": 1
                },
                "nthOfTypePath": {
                  "type": "string",
                  "maxLength": 1000
                },
                "siblingIndex": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 1000000000
                },
                "parentDescriptor": {
                  "type": "string",
                  "maxLength": 500
                },
                "semanticRole": {
                  "type": "string",
                  "maxLength": 200
                },
                "semanticAncestor": {
                  "type": "string",
                  "maxLength": 500
                },
                "previousSiblingDescriptor": {
                  "type": "string",
                  "maxLength": 500
                },
                "nextSiblingDescriptor": {
                  "type": "string",
                  "maxLength": 500
                },
                "selectorStability": {
                  "type": "string",
                  "enum": [
                    "high",
                    "medium",
                    "low"
                  ],
                  "maxLength": 80
                },
                "selectorStabilityReason": {
                  "type": "string",
                  "maxLength": 500
                }
              },
              "required": [
                "tagName",
                "cssPath"
              ],
              "additionalProperties": false
            },
            "confidence": {
              "type": "string",
              "enum": [
                "high",
                "medium",
                "low"
              ],
              "maxLength": 80
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        },
        "contents": {
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 500
          },
          "maxItems": 3
        },
        "nearby": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "direction": {
                "type": "string",
                "enum": [
                  "above",
                  "below",
                  "left",
                  "right"
                ],
                "maxLength": 80
              },
              "summary": {
                "type": "string",
                "maxLength": 500
              }
            },
            "required": [
              "direction",
              "summary"
            ],
            "additionalProperties": false
          },
          "maxItems": 8
        },
        "confidence": {
          "type": "string",
          "enum": [
            "high",
            "medium",
            "low"
          ],
          "maxLength": 80
        }
      },
      "required": [
        "userIntent",
        "pageMode",
        "anchor",
        "contents",
        "nearby"
      ],
      "additionalProperties": false
    },
    "target": {
      "type": "object",
      "properties": {
        "userIntent": {
          "type": "string",
          "maxLength": 4000
        },
        "pageMode": {
          "type": "string",
          "enum": [
            "slide",
            "long",
            "unknown"
          ],
          "maxLength": 80
        },
        "relativeBox": {
          "type": "object",
          "properties": {
            "left": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            },
            "top": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            },
            "right": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            },
            "bottom": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            },
            "width": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            },
            "height": {
              "type": "number",
              "minimum": -1000000000,
              "maximum": 1000000000
            }
          },
          "required": [
            "left",
            "top",
            "right",
            "bottom",
            "width",
            "height"
          ],
          "additionalProperties": false
        },
        "anchor": {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "slide",
                "section",
                "container",
                "document"
              ],
              "maxLength": 80
            },
            "label": {
              "type": "string",
              "maxLength": 300
            },
            "locator": {
              "type": "object",
              "properties": {
                "descriptor": {
                  "type": "string",
                  "maxLength": 500
                },
                "tagName": {
                  "type": "string",
                  "maxLength": 80
                },
                "roleHint": {
                  "type": "string",
                  "maxLength": 200
                },
                "textSnippet": {
                  "type": "string",
                  "maxLength": 500
                },
                "imageHint": {
                  "type": "string",
                  "maxLength": 1000
                },
                "classHint": {
                  "type": "string",
                  "maxLength": 500
                },
                "idHint": {
                  "type": "string",
                  "maxLength": 300
                },
                "cssPath": {
                  "type": "string",
                  "maxLength": 1000,
                  "minLength": 1
                },
                "nthOfTypePath": {
                  "type": "string",
                  "maxLength": 1000
                },
                "siblingIndex": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 1000000000
                },
                "parentDescriptor": {
                  "type": "string",
                  "maxLength": 500
                },
                "semanticRole": {
                  "type": "string",
                  "maxLength": 200
                },
                "semanticAncestor": {
                  "type": "string",
                  "maxLength": 500
                },
                "previousSiblingDescriptor": {
                  "type": "string",
                  "maxLength": 500
                },
                "nextSiblingDescriptor": {
                  "type": "string",
                  "maxLength": 500
                },
                "selectorStability": {
                  "type": "string",
                  "enum": [
                    "high",
                    "medium",
                    "low"
                  ],
                  "maxLength": 80
                },
                "selectorStabilityReason": {
                  "type": "string",
                  "maxLength": 500
                }
              },
              "required": [
                "tagName",
                "cssPath"
              ],
              "additionalProperties": false
            },
            "confidence": {
              "type": "string",
              "enum": [
                "high",
                "medium",
                "low"
              ],
              "maxLength": 80
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        },
        "contents": {
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 500
          },
          "maxItems": 3
        },
        "nearby": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "direction": {
                "type": "string",
                "enum": [
                  "above",
                  "below",
                  "left",
                  "right"
                ],
                "maxLength": 80
              },
              "summary": {
                "type": "string",
                "maxLength": 500
              }
            },
            "required": [
              "direction",
              "summary"
            ],
            "additionalProperties": false
          },
          "maxItems": 8
        },
        "confidence": {
          "type": "string",
          "enum": [
            "high",
            "medium",
            "low"
          ],
          "maxLength": 80
        }
      },
      "required": [
        "userIntent",
        "pageMode",
        "anchor",
        "contents",
        "nearby"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "id",
    "sequence",
    "kind",
    "summary"
  ],
  "additionalProperties": false
}$schema$;
begin
 if uid is null then raise exception 'authentication-required'; end if;
 if requested_project_id is null or requested_page_fingerprint is null or requested_page_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'invalid-fingerprint'; end if;
 if requested_tasks is null or jsonb_typeof(requested_tasks) is distinct from 'array' then raise exception 'invalid-tasks'; end if;
 if octet_length(requested_tasks::text)>262144 then raise exception 'payload-limit'; end if;
 if jsonb_array_length(requested_tasks) not between 1 and 100 then raise exception 'invalid-task-count'; end if;
 if not clickdeck_private.valid_json(requested_tasks) then raise exception 'invalid-tasks'; end if;
 -- Validate every incoming task BEFORE compaction; overwritten poison must not disappear.
 for task in select v from jsonb_array_elements(requested_tasks) v loop
  if not clickdeck_private.matches_task_schema(task,spec) then raise exception 'invalid-tasks'; end if;
 end loop;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,144));
 select * into project from public.clickdeck_projects where id=requested_project_id for update;
 if not found then raise exception 'project-not-found'; end if;
 if project.expires_at<=now() then raise exception 'project-expired'; end if;
 if project.page_fingerprint<>requested_page_fingerprint then raise exception 'fingerprint-mismatch'; end if;
 select * into member from public.clickdeck_members where project_id=requested_project_id and user_id=uid;
 if not found then raise exception 'member-not-found'; end if;
 if exists(select 1 from public.clickdeck_submissions where user_id=uid and submitted_at>now()-interval '5 seconds') then raise exception 'rate-limit'; end if;
 select coalesce(jsonb_agg(t.task order by s.submitted_at,s.id,t.ordinality),'[]') into previous
 from public.clickdeck_submissions s cross join lateral jsonb_array_elements(s.tasks) with ordinality t(task,ordinality)
 where s.project_id=requested_project_id and s.user_id=uid;
 combined := previous || requested_tasks;
 for task in select v from jsonb_array_elements(combined) v loop
  if not clickdeck_private.matches_task_schema(task,spec) or not clickdeck_private.valid_json(task) then raise exception 'invalid-tasks'; end if;
  if coalesce(task->'locator'->>'cssPath','')<>'' and
    ((task->>'kind'='style' and coalesce(task->>'property','')<>'') or
     (task->>'kind'='attribute' and coalesce(task->>'attribute','')<>'') or task->>'kind'='content') then
   k := jsonb_build_array(task->>'kind',task->'locator'->>'cssPath',task->'locator'->>'tagName',
    case task->>'kind' when 'style' then task->>'property' when 'attribute' then task->>'attribute' else 'text' end)::text;
  else k := jsonb_build_array('id',task->>'id')::text;
  end if;
  if slots ? k then
   first_task := slots->k;
   if first_task ? 'before' then task := task || jsonb_build_object('before',first_task->'before'); end if;
  else keys := array_append(keys,k);
  end if;
  slots := jsonb_set(slots,array[k],task);
 end loop;
 foreach k in array keys loop
  merged := merged || jsonb_build_array((slots->k)||jsonb_build_object('sequence',jsonb_array_length(merged)));
 end loop;
 select coalesce(sum(task_count),0),coalesce(sum(octet_length(tasks::text)),0) into other_count,other_bytes
 from public.clickdeck_submissions where project_id=requested_project_id and user_id<>uid;
 if other_count+jsonb_array_length(merged)>100 then raise exception 'task-limit'; end if;
 if other_bytes+octet_length(merged::text)>262144 then raise exception 'payload-limit'; end if;
 select count(*) into old_count from public.clickdeck_submissions where project_id=requested_project_id and user_id=uid;
 if old_count=1 then
  select id into result_id from public.clickdeck_submissions where project_id=requested_project_id and user_id=uid and tasks=merged;
  if found then return result_id; end if; -- No extra row and no expiry extension for identical data.
 end if;
 delete from public.clickdeck_submissions where project_id=requested_project_id and user_id=uid;
 insert into public.clickdeck_submissions(project_id,user_id,member_display_name,page_fingerprint,tasks)
 values(requested_project_id,uid,member.display_name,requested_page_fingerprint,merged) returning id into result_id;
 update public.clickdeck_projects set last_activity_at=now(),expires_at=now()+interval '48 hours' where id=requested_project_id;
 return result_id;
end; $fn$;
-- CREATE OR REPLACE preserves existing execute grants, including the emergency OFF state.
commit;

