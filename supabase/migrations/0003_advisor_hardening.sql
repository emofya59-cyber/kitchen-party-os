-- Advisor fixes (0028/0029): trim EXECUTE on SECURITY DEFINER functions.
-- Trigger functions need no EXECUTE grant for API roles.
revoke execute on function public.handle_new_org() from public, anon, authenticated;
-- RLS helpers are only used by policies scoped `to authenticated`.
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.has_org_role(uuid, public.member_role[]) from public, anon;
revoke execute on function public.is_event_vendor(uuid) from public, anon;
-- is_demo_event is used by anon demo policies (keep anon); bridge RPCs are key-gated
-- and called by the Pages Function with the anon key. Signed-in users don't need them.
revoke execute on function public.bridge_list(text, uuid) from authenticated;
revoke execute on function public.bridge_post(text, text, text, text, text, jsonb, uuid) from authenticated;
