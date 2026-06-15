// import { SetMetadata } from '@nestjs/common';
// import { PolicyHandler } from '../../modules/casl/policy-handler.interface';

// export const CHECK_POLICIES_KEY = 'check_policy';

// /**
//  * Decorator: attach one or more policy handlers to a route.
//  *
//  * Usage:
//  *   @CheckPolicies((ability) => ability.can(Action.Read, 'LoanProduct'))
//  *   @CheckPolicies(new ReadLoanProductPolicy())
//  */
// export const CheckPolicies = (...handlers: PolicyHandler[]) => SetMetadata(CHECK_POLICIES_KEY, handlers);
