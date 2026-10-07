import {TRPCError} from '@trpc/server'
import {z} from 'zod'

import {privateProcedure, privateProcedureWithMembers, router} from '../server/trpc/trpc.js'

export default router({
	// Members launch apps too, so they need to know each app's public hostname.
	get: privateProcedureWithMembers.query(({ctx}) => ctx.umbreld.domainAccess.get()),
	set: privateProcedure
		.input(
			z
				.object({
					enabled: z.boolean(),
					domain: z.string().trim().min(1).max(253),
					appHostTemplate: z.string().trim().max(253).optional(),
				})
				.strict(),
		)
		.mutation(async ({ctx, input}) => {
			try {
				return await ctx.umbreld.domainAccess.set(input)
			} catch (error) {
				throw new TRPCError({code: 'BAD_REQUEST', message: (error as Error).message})
			}
		}),
	clear: privateProcedure.mutation(({ctx}) => ctx.umbreld.domainAccess.clear()),
})
