import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GroupAccess } from '../groups/group-access';
import { PlanService } from '../groups/plan.service';
import { PotService } from '../groups/pot.service';
import { PublicGroupsController } from '../groups/public-groups.controller';
import { PublicGroupsService } from '../groups/public-groups.service';
import { TxillGroupsController } from '../groups/txillgroups.controller';
import { MediaModule } from '../media/media.module';
import { MusicModule } from '../music/music.module';
import { PostsModule } from '../posts/posts.module';
import { VenuesModule } from '../venues/venues.module';
import { WalletModule } from '../wallet/wallet.module';
import { ChatController } from './chat.controller';
import { ChatEvents } from './chat.events';
import { ChatService } from './chat.service';
import { GroupsService } from './groups.service';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { PresenceController, PresenceService } from './presence.controller';

@Module({
  imports: [AuthModule, MediaModule, MusicModule, PostsModule, WalletModule, VenuesModule],
  // Os TxillGroups (plano, sondagens, lista, despesas, álbum, cofre e a porta de fora: ver, entrar e pedir) vivem em src/groups,
  // mas partilham este módulo com os grupos do chat.
  controllers: [ChatController, NotesController, PresenceController, TxillGroupsController, PublicGroupsController],
  providers: [ChatService, GroupsService, NotesService, ChatEvents, PresenceService, GroupAccess, PlanService, PotService, PublicGroupsService],
  exports: [ChatService, ChatEvents],
})
export class ChatModule {}
