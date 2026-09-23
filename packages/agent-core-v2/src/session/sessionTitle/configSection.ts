import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';

export const AUTO_SESSION_TITLE_SECTION = 'autoSessionTitle';

export const AutoSessionTitleSchema = z.boolean();

registerConfigSection(AUTO_SESSION_TITLE_SECTION, AutoSessionTitleSchema);
