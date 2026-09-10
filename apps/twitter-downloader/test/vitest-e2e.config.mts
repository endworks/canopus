import { canopusVitest } from '../../../vitest.shared.mts';

/** The same setup, pointed at the end-to-end suite rather than the units. */
export default canopusVitest(['test/**/*.e2e-spec.ts']);
