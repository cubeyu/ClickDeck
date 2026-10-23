-- Task 145: schema mirrors src/shared/collaboration-task-schema.json.
begin;
create or replace function clickdeck_private.matches_task_schema(value jsonb, spec jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare field text; child jsonb; units integer;
begin
 if value is null then return false; end if;
 case spec->>'type'
 when 'object' then
  if jsonb_typeof(value) is distinct from 'object' then return false; end if;
  for field in select jsonb_array_elements_text(coalesce(spec->'required','[]')) loop
   if not value ? field then return false; end if;
  end loop;
  for field, child in select key,val from jsonb_each(value) e(key,val) loop
   if not (spec->'properties') ? field or not clickdeck_private.matches_task_schema(child,spec->'properties'->field) then return false; end if;
  end loop;
 when 'array' then
  if jsonb_typeof(value) is distinct from 'array' then return false; end if;
  if jsonb_array_length(value) > (spec->>'maxItems')::integer then return false; end if;
  for child in select v from jsonb_array_elements(value) v loop
   if not clickdeck_private.matches_task_schema(child,spec->'items') then return false; end if;
  end loop;
 when 'string' then
  if jsonb_typeof(value) is distinct from 'string' then return false; end if;
  -- Match JavaScript UTF-16 length, including supplementary Unicode characters.
  select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0) into units from regexp_split_to_table(value #>> '{}','') c;
  if units < coalesce((spec->>'minLength')::integer,0) or units > (spec->>'maxLength')::integer then return false; end if;
  if spec ? 'enum' and not (spec->'enum') @> jsonb_build_array(value) then return false; end if;
 else
  if jsonb_typeof(value) is distinct from 'number' then return false; end if;
  if (value::text)::numeric < (spec->>'minimum')::numeric or (value::text)::numeric > (spec->>'maximum')::numeric then return false; end if;
  if spec->>'type'='integer' and trunc((value::text)::numeric) <> (value::text)::numeric then return false; end if;
 end case;
 return true;
end; $$;
create or replace function clickdeck_private.validate_submission_schema()
returns trigger language plpgsql set search_path = '' as $$
declare task jsonb;
 spec constant jsonb := $schema${"type":"object","properties":{"id":{"type":"string","maxLength":200,"minLength":1},"sequence":{"type":"integer","minimum":0,"maximum":999999999},"kind":{"type":"string","enum":["style","content","attribute","intent","move","remove"],"maxLength":80},"summary":{"type":"string","maxLength":4000,"minLength":1},"locator":{"type":"object","properties":{"descriptor":{"type":"string","maxLength":500},"tagName":{"type":"string","maxLength":80},"roleHint":{"type":"string","maxLength":200},"textSnippet":{"type":"string","maxLength":500},"imageHint":{"type":"string","maxLength":1000},"classHint":{"type":"string","maxLength":500},"idHint":{"type":"string","maxLength":300},"cssPath":{"type":"string","maxLength":1000,"minLength":1},"nthOfTypePath":{"type":"string","maxLength":1000},"siblingIndex":{"type":"integer","minimum":0,"maximum":1000000000},"parentDescriptor":{"type":"string","maxLength":500},"semanticRole":{"type":"string","maxLength":200},"semanticAncestor":{"type":"string","maxLength":500},"previousSiblingDescriptor":{"type":"string","maxLength":500},"nextSiblingDescriptor":{"type":"string","maxLength":500},"selectorStability":{"type":"string","enum":["high","medium","low"],"maxLength":80},"selectorStabilityReason":{"type":"string","maxLength":500}},"required":["tagName","cssPath"],"additionalProperties":false},"before":{"type":"string","maxLength":4000},"after":{"type":"string","maxLength":4000},"property":{"type":"string","maxLength":100},"attribute":{"type":"string","enum":["src"],"maxLength":80},"source":{"type":"object","properties":{"userIntent":{"type":"string","maxLength":4000},"pageMode":{"type":"string","enum":["slide","long","unknown"],"maxLength":80},"relativeBox":{"type":"object","properties":{"left":{"type":"number","minimum":-1000000000,"maximum":1000000000},"top":{"type":"number","minimum":-1000000000,"maximum":1000000000},"right":{"type":"number","minimum":-1000000000,"maximum":1000000000},"bottom":{"type":"number","minimum":-1000000000,"maximum":1000000000},"width":{"type":"number","minimum":-1000000000,"maximum":1000000000},"height":{"type":"number","minimum":-1000000000,"maximum":1000000000}},"required":["left","top","right","bottom","width","height"],"additionalProperties":false},"anchor":{"type":"object","properties":{"kind":{"type":"string","enum":["slide","section","container","document"],"maxLength":80},"label":{"type":"string","maxLength":300},"locator":{"type":"object","properties":{"descriptor":{"type":"string","maxLength":500},"tagName":{"type":"string","maxLength":80},"roleHint":{"type":"string","maxLength":200},"textSnippet":{"type":"string","maxLength":500},"imageHint":{"type":"string","maxLength":1000},"classHint":{"type":"string","maxLength":500},"idHint":{"type":"string","maxLength":300},"cssPath":{"type":"string","maxLength":1000,"minLength":1},"nthOfTypePath":{"type":"string","maxLength":1000},"siblingIndex":{"type":"integer","minimum":0,"maximum":1000000000},"parentDescriptor":{"type":"string","maxLength":500},"semanticRole":{"type":"string","maxLength":200},"semanticAncestor":{"type":"string","maxLength":500},"previousSiblingDescriptor":{"type":"string","maxLength":500},"nextSiblingDescriptor":{"type":"string","maxLength":500},"selectorStability":{"type":"string","enum":["high","medium","low"],"maxLength":80},"selectorStabilityReason":{"type":"string","maxLength":500}},"required":["tagName","cssPath"],"additionalProperties":false},"confidence":{"type":"string","enum":["high","medium","low"],"maxLength":80}},"required":["kind"],"additionalProperties":false},"contents":{"type":"array","items":{"type":"string","maxLength":500},"maxItems":3},"nearby":{"type":"array","items":{"type":"object","properties":{"direction":{"type":"string","enum":["above","below","left","right"],"maxLength":80},"summary":{"type":"string","maxLength":500}},"required":["direction","summary"],"additionalProperties":false},"maxItems":8},"confidence":{"type":"string","enum":["high","medium","low"],"maxLength":80}},"required":["userIntent","pageMode","anchor","contents","nearby"],"additionalProperties":false},"target":{"type":"object","properties":{"userIntent":{"type":"string","maxLength":4000},"pageMode":{"type":"string","enum":["slide","long","unknown"],"maxLength":80},"relativeBox":{"type":"object","properties":{"left":{"type":"number","minimum":-1000000000,"maximum":1000000000},"top":{"type":"number","minimum":-1000000000,"maximum":1000000000},"right":{"type":"number","minimum":-1000000000,"maximum":1000000000},"bottom":{"type":"number","minimum":-1000000000,"maximum":1000000000},"width":{"type":"number","minimum":-1000000000,"maximum":1000000000},"height":{"type":"number","minimum":-1000000000,"maximum":1000000000}},"required":["left","top","right","bottom","width","height"],"additionalProperties":false},"anchor":{"type":"object","properties":{"kind":{"type":"string","enum":["slide","section","container","document"],"maxLength":80},"label":{"type":"string","maxLength":300},"locator":{"type":"object","properties":{"descriptor":{"type":"string","maxLength":500},"tagName":{"type":"string","maxLength":80},"roleHint":{"type":"string","maxLength":200},"textSnippet":{"type":"string","maxLength":500},"imageHint":{"type":"string","maxLength":1000},"classHint":{"type":"string","maxLength":500},"idHint":{"type":"string","maxLength":300},"cssPath":{"type":"string","maxLength":1000,"minLength":1},"nthOfTypePath":{"type":"string","maxLength":1000},"siblingIndex":{"type":"integer","minimum":0,"maximum":1000000000},"parentDescriptor":{"type":"string","maxLength":500},"semanticRole":{"type":"string","maxLength":200},"semanticAncestor":{"type":"string","maxLength":500},"previousSiblingDescriptor":{"type":"string","maxLength":500},"nextSiblingDescriptor":{"type":"string","maxLength":500},"selectorStability":{"type":"string","enum":["high","medium","low"],"maxLength":80},"selectorStabilityReason":{"type":"string","maxLength":500}},"required":["tagName","cssPath"],"additionalProperties":false},"confidence":{"type":"string","enum":["high","medium","low"],"maxLength":80}},"required":["kind"],"additionalProperties":false},"contents":{"type":"array","items":{"type":"string","maxLength":500},"maxItems":3},"nearby":{"type":"array","items":{"type":"object","properties":{"direction":{"type":"string","enum":["above","below","left","right"],"maxLength":80},"summary":{"type":"string","maxLength":500}},"required":["direction","summary"],"additionalProperties":false},"maxItems":8},"confidence":{"type":"string","enum":["high","medium","low"],"maxLength":80}},"required":["userIntent","pageMode","anchor","contents","nearby"],"additionalProperties":false}},"required":["id","sequence","kind","summary"],"additionalProperties":false}$schema$;
begin
 for task in select v from jsonb_array_elements(new.tasks) v loop
  if not clickdeck_private.matches_task_schema(task,spec) then raise exception 'invalid-tasks'; end if;
 end loop;
 return new;
end; $$;
create trigger clickdeck_submission_schema_guard before insert or update of tasks on public.clickdeck_submissions
for each row execute function clickdeck_private.validate_submission_schema();
revoke all on function clickdeck_private.matches_task_schema(jsonb,jsonb), clickdeck_private.validate_submission_schema() from public,anon,authenticated;
commit;
