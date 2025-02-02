import { useResetSupportInteraction } from '@automattic/help-center/src/hooks/use-reset-support-interaction';
import { HELP_CENTER_STORE } from '@automattic/help-center/src/stores';
import { getShortDateString } from '@automattic/i18n-utils';
import { Spinner } from '@wordpress/components';
import { useDispatch as useDataStoreDispatch } from '@wordpress/data';
import { __, _n } from '@wordpress/i18n';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ThumbsDown } from '../../assets/thumbs-down';
import { useOdieAssistantContext } from '../../context';
import { useGetSupportInteractionById } from '../../data/use-get-support-interaction-by-id';
import {
	useAutoScroll,
	useCreateZendeskConversation,
	useZendeskMessageListener,
} from '../../hooks';
import { useGetMostRecentOpenConversation } from '../../hooks/use-get-most-recent-open-conversation';
import { getOdieInitialMessage } from '../../utils';
import OdieNotice from '../odie-notice';
import { DislikeFeedbackMessage } from './dislike-feedback-message';
import { JumpToRecent } from './jump-to-recent';
import { ThinkingPlaceholder } from './thinking-placeholder';
import ChatMessage from '.';
import type { Chat, CurrentUser } from '../../types';

const DislikeThumb = () => {
	return (
		<div className="chatbox-message__dislike-thumb">
			<ThumbsDown />
		</div>
	);
};

const LoadingChatSpinner = () => {
	return (
		<div className="chatbox-loading-chat__spinner">
			<Spinner />
		</div>
	);
};

const ChatDate = ( { chat }: { chat: Chat } ) => {
	// chat.messages[ 1 ] contains the first user interaction, therefore the date, otherwise the current date.
	const chatDate =
		chat.messages.length > 1 ? chat.messages[ 1 ]?.created_at || Date.now() : Date.now();
	const currentDate = getShortDateString( chatDate as number );
	return <div className="odie-chat__date">{ currentDate }</div>;
};

const ViewMostRecentOpenConversationNotice = () => {
	const { mostRecentSupportInteractionId, totalNumberOfConversations } =
		useGetMostRecentOpenConversation();

	const fetchSupportInteraction =
		mostRecentSupportInteractionId?.toString() && totalNumberOfConversations === 1
			? mostRecentSupportInteractionId.toString()
			: null;
	const { data: supportInteraction } = useGetSupportInteractionById( fetchSupportInteraction );
	const { setCurrentSupportInteraction } = useDataStoreDispatch( HELP_CENTER_STORE );
	const { trackEvent } = useOdieAssistantContext();
	const location = useLocation();
	const navigate = useNavigate();
	const shouldDisplayNotice = supportInteraction || totalNumberOfConversations > 1;

	const handleNoticeOnClick = () => {
		if ( supportInteraction ) {
			setCurrentSupportInteraction( supportInteraction );
			if ( ! location.pathname.includes( '/odie' ) ) {
				navigate( '/odie' );
			}
		} else {
			navigate( '/chat-history' );
		}
		trackEvent( 'chat_open_previous_conversation_notice', {
			destination: supportInteraction ? 'support-interaction' : 'chat-history',
			total_number_of_conversations: totalNumberOfConversations,
		} );
	};

	return (
		shouldDisplayNotice && (
			<OdieNotice>
				<div className="odie-notice__view-conversation">
					<span>
						{ __( 'You have another open conversation already started.', __i18n_text_domain__ ) }
					</span>
					&nbsp;
					<button onClick={ handleNoticeOnClick }>
						{ _n(
							'View conversation',
							'View conversations',
							totalNumberOfConversations,
							__i18n_text_domain__
						) }
					</button>
				</div>
			</OdieNotice>
		)
	);
};

interface ChatMessagesProps {
	currentUser: CurrentUser;
}

export const MessagesContainer = ( { currentUser }: ChatMessagesProps ) => {
	const { chat, botNameSlug, experimentVariationName, isChatLoaded } = useOdieAssistantContext();
	const createZendeskConversation = useCreateZendeskConversation();
	const resetSupportInteraction = useResetSupportInteraction();
	const [ searchParams, setSearchParams ] = useSearchParams();
	const isForwardingToZendesk =
		searchParams.get( 'provider' ) === 'zendesk' && chat.provider !== 'zendesk';
	const [ hasForwardedToZendesk, setHasForwardedToZendesk ] = useState( false );
	const [ chatMessagesLoaded, setChatMessagesLoaded ] = useState( false );
	const messagesContainerRef = useRef< HTMLDivElement >( null );
	useZendeskMessageListener();
	useAutoScroll( messagesContainerRef );

	useEffect( () => {
		if ( isForwardingToZendesk || hasForwardedToZendesk ) {
			return;
		}

		( chat?.status === 'loaded' || chat?.status === 'closed' ) && setChatMessagesLoaded( true );
	}, [ chat, isForwardingToZendesk, hasForwardedToZendesk ] );

	/**
	 * Handle the case where we are forwarding to Zendesk.
	 */
	useEffect( () => {
		if (
			isForwardingToZendesk &&
			! hasForwardedToZendesk &&
			! chat.conversationId &&
			createZendeskConversation &&
			resetSupportInteraction &&
			isChatLoaded
		) {
			searchParams.delete( 'provider' );
			searchParams.set( 'direct-zd-chat', '1' );
			setSearchParams( searchParams );
			setHasForwardedToZendesk( true );

			resetSupportInteraction().then( ( interaction ) => {
				if ( isChatLoaded ) {
					createZendeskConversation( true, interaction?.uuid ).then( () => {
						setChatMessagesLoaded( true );
					} );
				}
			} );
		}
	}, [
		isForwardingToZendesk,
		hasForwardedToZendesk,
		isChatLoaded,
		chat?.conversationId,
		resetSupportInteraction,
		createZendeskConversation,
	] );

	// Used to apply the correct styling on messages
	const isNextMessageFromSameSender = ( currentMessage: string, nextMessage: string ) => {
		return currentMessage === nextMessage;
	};

	const removeDislikeStatus = experimentVariationName === 'give_wapuu_a_chance';

	const availableStatusWithFeedback = removeDislikeStatus
		? [ 'sending', 'transfer' ]
		: [ 'sending', 'dislike', 'transfer' ];

	return (
		<>
			<div className="chatbox-messages" ref={ messagesContainerRef }>
				<ChatDate chat={ chat } />
				{ ! chatMessagesLoaded ? (
					<LoadingChatSpinner />
				) : (
					<>
						{ ( chat.odieId || chat.provider === 'odie' ) && (
							<ChatMessage
								message={ getOdieInitialMessage( botNameSlug ) }
								key={ 0 }
								currentUser={ currentUser }
								isNextMessageFromSameSender={ false }
								displayChatWithSupportLabel={ false }
							/>
						) }
						{ chat.messages.map( ( message, index ) => (
							<ChatMessage
								message={ message }
								key={ index }
								currentUser={ currentUser }
								isNextMessageFromSameSender={ isNextMessageFromSameSender(
									message.role,
									chat.messages[ index + 1 ]?.role
								) }
								displayChatWithSupportLabel={ message.context?.flags?.show_contact_support_msg }
							/>
						) ) }
						<JumpToRecent containerReference={ messagesContainerRef } />
						{ chat.provider === 'odie' && <ViewMostRecentOpenConversationNotice /> }
						{ chat.status === 'dislike' && ! removeDislikeStatus && <DislikeThumb /> }
						{ availableStatusWithFeedback.includes( chat.status ) && (
							<div className="odie-chatbox__action-message">
								{ chat.status === 'sending' && <ThinkingPlaceholder /> }
								{ chat.status === 'dislike' && <DislikeFeedbackMessage /> }
							</div>
						) }
					</>
				) }
			</div>
		</>
	);
};
