import { FRONTEND } from "$lib/constants";
import type { PageLoad } from "./$types"
import { redirect } from "@sveltejs/kit";

export const load: PageLoad = (async ({ parent }: any) => {
	const { user } = await parent();
	const URL = user ? `/profile/${user.username}` : `/account_setup`;
	
	throw redirect(302, URL);

}) satisfies PageLoad;
